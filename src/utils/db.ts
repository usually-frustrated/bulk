import type { Env } from '../types';
import type { ExportEntry, SizeResult, MeasuredSize, CDN } from './cdn';
import { parseExports } from './cdn';
import type { ResourceTiming } from '../handlers/measurement';

// ─── version resolution (@latest → semver) ───────────────────────────────────

export async function resolveVersion(pkg: string, env: Env): Promise<string> {
	const hit = await env.DB.prepare(
		`SELECT version FROM version_resolution
		 WHERE package = ? AND fetched_at > datetime('now', '-1 hour')`,
	)
		.bind(pkg)
		.first<{ version: string }>();
	if (hit) return hit.version;

	const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
		headers: { Accept: 'application/json' },
	});
	if (!res.ok) throw Object.assign(new Error(`Package not found: ${pkg}`), { status: 404 });

	const { version } = (await res.json()) as { version: string };

	await env.DB.prepare(
		`INSERT OR REPLACE INTO version_resolution (package, version, fetched_at)
		 VALUES (?, ?, datetime('now'))`,
	)
		.bind(pkg, version)
		.run();

	return version;
}

// ─── package exports map ─────────────────────────────────────────────────────

export async function getPackageExports(
	pkg: string,
	version: string,
	env: Env,
): Promise<ExportEntry[]> {
	const hit = await env.DB.prepare(
		`SELECT exports FROM package_exports WHERE package = ? AND version = ?`,
	)
		.bind(pkg, version)
		.first<{ exports: string }>();
	if (hit) return JSON.parse(hit.exports) as ExportEntry[];

	const res = await fetch(`https://registry.npmjs.org/${pkg}/${version}`, {
		headers: { Accept: 'application/json' },
	});
	if (!res.ok) throw Object.assign(new Error(`Package not found: ${pkg}@${version}`), { status: 404 });

	const pkgJson = (await res.json()) as Record<string, unknown>;
	const entries = parseExports(pkgJson);

	await env.DB.prepare(
		`INSERT OR REPLACE INTO package_exports (package, version, exports, fetched_at)
		 VALUES (?, ?, ?, datetime('now'))`,
	)
		.bind(pkg, version, JSON.stringify(entries))
		.run();

	return entries;
}

// ─── cdn_sizes ───────────────────────────────────────────────────────────────

interface CachedSize {
	bytes_raw: number | null;
	bytes_transfer: number | null;
}

export async function getCachedSize(
	pkg: string,
	version: string,
	exportKey: string,
	cdn: CDN,
	env: Env,
): Promise<CachedSize | null> {
	return env.DB.prepare(
		`SELECT bytes_raw, bytes_transfer FROM cdn_sizes
		 WHERE package = ? AND version = ? AND export_key = ? AND cdn = ?`,
	)
		.bind(pkg, version, exportKey, cdn)
		.first<CachedSize>();
}

export async function getCachedSizesBatch(
	pkg: string,
	versions: string[],
	exportKey: string,
	cdn: CDN,
	env: Env,
): Promise<Map<string, CachedSize>> {
	if (!versions.length) return new Map();
	const ph = versions.map(() => '?').join(',');
	const rows = await env.DB.prepare(
		`SELECT version, bytes_raw, bytes_transfer FROM cdn_sizes
		 WHERE package = ? AND export_key = ? AND cdn = ? AND version IN (${ph})`,
	)
		.bind(pkg, exportKey, cdn, ...versions)
		.all<{ version: string } & CachedSize>();
	return new Map(rows.results.map((r) => [r.version, { bytes_raw: r.bytes_raw, bytes_transfer: r.bytes_transfer }]));
}

export async function saveSize(
	pkg: string,
	version: string,
	exportKey: string,
	cdn: CDN,
	size: SizeResult,
	env: Env,
): Promise<void> {
	await env.DB.prepare(
		`INSERT OR REPLACE INTO cdn_sizes
		 (package, version, export_key, cdn, bytes_raw, bytes_transfer, fetched_at)
		 VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
	)
		.bind(pkg, version, exportKey, cdn, size.bytes_raw, size.bytes_transfer)
		.run();
}

// ─── resource timings (browser measurements) ────────────────────────────────

/**
 * Store annotated resource timing entries from a browser measurement session.
 * Skips rows with transferSize = 0 (cached) or null.
 */
export async function saveResourceTimings(
	resources: ResourceTiming[],
	cdn: string,
	browser: string,
	connection: string,
	env: Env,
): Promise<void> {
	const stmts = resources.map((r) =>
		env.DB.prepare(
			`INSERT INTO resource_timings
			 (package, version, export_key, cdn, browser, connection,
			  transfer_size, decoded_body_size, start_time, response_end, url)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).bind(
			r.pkg,
			r.version,
			r.exportKey,
			cdn,
			browser,
			connection,
			r.transferSize,
			r.decodedBodySize,
			r.startTime,
			r.responseEnd,
			r.url,
		),
	);
	if (stmts.length) await env.DB.batch(stmts);
}

/**
 * Return the P50 transfer/decoded sizes from recent browser measurements,
 * together with a confidence tier based on independent sample count (Decision 2):
 *   0–9  → null (unverified; caller falls back to server-estimate)
 *   10–39 → MeasuredSize with confidence='tentative'
 *   40+   → MeasuredSize with confidence='established'
 */
export async function getMeasuredSize(
	pkg: string,
	version: string,
	exportKey: string,
	cdn: CDN,
	env: Env,
): Promise<MeasuredSize | null> {
	// Count first so we can short-circuit before the heavier median query.
	const count = await env.DB.prepare(
		`SELECT COUNT(*) AS n FROM resource_timings
		 WHERE package = ? AND version = ? AND export_key = ? AND cdn = ?
		   AND timestamp > datetime('now', '-30 days')
		   AND transfer_size > 0`,
	)
		.bind(pkg, version, exportKey, cdn)
		.first<{ n: number }>();

	const n = count?.n ?? 0;
	if (n < 10) return null; // unverified — too few samples for the badge/API

	// SQLite median: pick the middle row after ordering by transfer_size.
	const row = await env.DB.prepare(
		`SELECT transfer_size AS bytes_transfer, decoded_body_size AS bytes_raw
		 FROM resource_timings
		 WHERE package = ? AND version = ? AND export_key = ? AND cdn = ?
		   AND timestamp > datetime('now', '-30 days')
		   AND transfer_size > 0
		 ORDER BY transfer_size
		 LIMIT 1
		 OFFSET (
		   SELECT (COUNT(*) - 1) / 2
		   FROM resource_timings
		   WHERE package = ? AND version = ? AND export_key = ? AND cdn = ?
		     AND timestamp > datetime('now', '-30 days')
		     AND transfer_size > 0
		 )`,
	)
		.bind(pkg, version, exportKey, cdn, pkg, version, exportKey, cdn)
		.first<{ bytes_transfer: number | null; bytes_raw: number | null }>();

	if (!row) return null;

	return {
		bytes_transfer: row.bytes_transfer,
		bytes_raw: row.bytes_raw,
		confidence: n >= 40 ? 'established' : 'tentative',
		sampleCount: n,
	};
}

// ─── latest resource timings (for banner waterfall) ─────────────────────────

export interface ResourceTimingRow {
	url:               string;
	transfer_size:     number | null;
	decoded_body_size: number | null;
	start_time:        number;
	response_end:      number;
}

/**
 * Return all resource timing entries from the most recent measurement session
 * for the given package/version/export/cdn combination.
 * Uses the MAX(timestamp) to identify the latest session (batched INSERTs share
 * the same second-precision datetime value).
 */
export async function getLatestResourceTimings(
	pkg: string,
	version: string,
	exportKey: string,
	cdn: CDN,
	env: Env,
): Promise<ResourceTimingRow[]> {
	const rows = await env.DB.prepare(
		`SELECT url, transfer_size, decoded_body_size, start_time, response_end
		 FROM resource_timings
		 WHERE package = ? AND version = ? AND export_key = ? AND cdn = ?
		   AND timestamp = (
		     SELECT MAX(timestamp)
		     FROM resource_timings
		     WHERE package = ? AND version = ? AND export_key = ? AND cdn = ?
		   )
		 ORDER BY start_time
		 LIMIT 50`,
	)
		.bind(pkg, version, exportKey, cdn, pkg, version, exportKey, cdn)
		.all<ResourceTimingRow>();
	return rows.results;
}

// ─── version history list ────────────────────────────────────────────────────

export interface VersionEntry {
	version: string;
	publishedAt: string;
}

function parseSemver(v: string): [number, number, number] | null {
	const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
	return m ? [+m[1], +m[2], +m[3]] : null;
}

function semverGt(a: string, b: string): boolean {
	const pa = parseSemver(a);
	const pb = parseSemver(b);
	if (!pa || !pb) return false;
	for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
	return false;
}

function filterVersionHistory(time: Record<string, string>): VersionEntry[] {
	const SKIP = new Set(['created', 'modified']);
	const groups = new Map<string, VersionEntry>();

	for (const [v, date] of Object.entries(time)) {
		if (SKIP.has(v) || v.includes('-') || !parseSemver(v)) continue;
		const key = v.split('.').slice(0, 2).join('.');
		const prev = groups.get(key);
		if (!prev || semverGt(v, prev.version)) groups.set(key, { version: v, publishedAt: date });
	}

	return [...groups.values()]
		.sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime())
		.slice(-50);
}

export async function getVersionList(pkg: string, env: Env): Promise<VersionEntry[]> {
	// Fresh enough if fetched within 24 hours
	const meta = await env.DB.prepare(
		`SELECT fetched_at FROM package_versions_fetched
		 WHERE package = ? AND fetched_at > datetime('now', '-1 day')`,
	)
		.bind(pkg)
		.first<{ fetched_at: string }>();

	if (meta) {
		const rows = await env.DB.prepare(
			`SELECT version, published_at FROM package_versions
			 WHERE package = ? ORDER BY published_at ASC`,
		)
			.bind(pkg)
			.all<{ version: string; published_at: string }>();
		return rows.results.map((r) => ({ version: r.version, publishedAt: r.published_at }));
	}

	const res = await fetch(`https://registry.npmjs.org/${pkg}`, {
		headers: { Accept: 'application/json' },
	});
	if (!res.ok) throw Object.assign(new Error(`Package not found: ${pkg}`), { status: 404 });

	const data = (await res.json()) as { time?: Record<string, string> };
	if (!data.time) throw new Error('No version history available');

	const entries = filterVersionHistory(data.time);

	await env.DB.batch([
		env.DB.prepare(
			`INSERT OR REPLACE INTO package_versions_fetched (package, fetched_at)
			 VALUES (?, datetime('now'))`,
		).bind(pkg),
		...entries.map((e) =>
			env.DB.prepare(
				`INSERT OR IGNORE INTO package_versions (package, version, published_at)
				 VALUES (?, ?, ?)`,
			).bind(pkg, e.version, e.publishedAt),
		),
	]);

	return entries;
}
