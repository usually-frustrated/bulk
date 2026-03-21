import type { Env } from '../types';
import type { ExportEntry, SizeResult, CDN } from './cdn';
import { parseExports } from './cdn';

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
