import type { Env } from '../types';
import type { BundleJobMessage } from '../types';

interface VersionEntry {
	version: string;
	publishedAt: string;
}

export interface HistoryVersion {
	version: string;
	publishedAt: string;
	bytes: number | null;
	jobId?: string;
}

// /_bundle-history/<pkg>[/<exportPath>]
// Scoped:   /_bundle-history/@scope/name[/export]
// Unscoped: /_bundle-history/name[/export]
function parseHistoryPath(pathname: string): { package: string; exportPath: string } | null {
	const prefix = '/_bundle-history/';
	if (!pathname.startsWith(prefix)) return null;
	const rest = pathname.slice(prefix.length);
	if (!rest) return null;

	if (rest.startsWith('@')) {
		const match = rest.match(/^(@[^/@][^/]*\/[^/]+)(?:\/(.+))?$/);
		if (!match) return null;
		return { package: match[1], exportPath: match[2] ?? 'index' };
	}

	const slash = rest.indexOf('/');
	return slash === -1
		? { package: rest, exportPath: 'index' }
		: { package: rest.slice(0, slash), exportPath: rest.slice(slash + 1) };
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

/** One representative version per minor (highest patch), sorted by publish date, capped at 50. */
function filterVersionHistory(time: Record<string, string>): VersionEntry[] {
	const SKIP = new Set(['created', 'modified']);
	const groups = new Map<string, VersionEntry>();

	for (const [v, date] of Object.entries(time)) {
		if (SKIP.has(v) || v.includes('-')) continue;
		if (!parseSemver(v)) continue;
		const key = v.split('.').slice(0, 2).join('.');
		const prev = groups.get(key);
		if (!prev || semverGt(v, prev.version)) groups.set(key, { version: v, publishedAt: date });
	}

	return [...groups.values()]
		.sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime())
		.slice(-50);
}

async function getVersionHistory(pkg: string, env: Env): Promise<VersionEntry[]> {
	const kvKey = `pkg-history:${pkg}`;
	const hit = await env.VERSION_CACHE.get(kvKey);
	if (hit) return JSON.parse(hit) as VersionEntry[];

	const res = await fetch(`https://registry.npmjs.org/${pkg}`, {
		headers: { Accept: 'application/json' },
	});
	if (!res.ok) throw Object.assign(new Error(`Package not found: ${pkg}`), { status: 404 });

	const data = (await res.json()) as { time?: Record<string, string> };
	if (!data.time) throw new Error('No version history in registry response');

	const entries = filterVersionHistory(data.time);
	// 24-hour cache — new releases show up next day at the latest
	await env.VERSION_CACHE.put(kvKey, JSON.stringify(entries), { expirationTtl: 86400 });
	return entries;
}

function counterStub(env: Env): DurableObjectStub {
	return env.QUEUE_COUNTER.get(env.QUEUE_COUNTER.idFromName('global'));
}

export async function handleBundleHistory(request: Request, env: Env): Promise<Response> {
	if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

	const parsed = parseHistoryPath(new URL(request.url).pathname);
	if (!parsed) return new Response('Invalid path', { status: 400 });

	const { package: pkg, exportPath } = parsed;

	let entries: VersionEntry[];
	try {
		entries = await getVersionHistory(pkg, env);
	} catch (err: unknown) {
		const status = (err as { status?: number }).status ?? 502;
		return new Response(err instanceof Error ? err.message : 'Failed', { status });
	}

	if (entries.length === 0) {
		return Response.json({ package: pkg, export: exportPath, versions: [] });
	}

	const versions = entries.map((e) => e.version);
	const ph = versions.map(() => '?').join(',');

	// Batch-fetch all cached sizes in one query
	const cacheRows = await env.DB.prepare(
		`SELECT version, bytes FROM bundle_cache
		 WHERE package = ? AND export_path = ? AND version IN (${ph})`,
	)
		.bind(pkg, exportPath, ...versions)
		.all<{ version: string; bytes: number }>();

	const cachedMap = new Map(cacheRows.results.map((r) => [r.version, r.bytes]));

	// Fetch any existing pending/processing jobs for these versions
	const jobRows = await env.DB.prepare(
		`SELECT version, id FROM bundle_jobs
		 WHERE package = ? AND export_path = ? AND version IN (${ph})
		   AND status IN ('pending', 'processing')
		 ORDER BY created_at DESC`,
	)
		.bind(pkg, exportPath, ...versions)
		.all<{ version: string; id: string }>();

	// Keep the most recent job per version
	const pendingMap = new Map<string, string>();
	for (const row of jobRows.results) {
		if (!pendingMap.has(row.version)) pendingMap.set(row.version, row.id);
	}

	const counter = counterStub(env);
	const result: HistoryVersion[] = [];

	for (const { version, publishedAt } of entries) {
		if (cachedMap.has(version)) {
			result.push({ version, publishedAt, bytes: cachedMap.get(version)! });
			continue;
		}
		if (pendingMap.has(version)) {
			result.push({ version, publishedAt, bytes: null, jobId: pendingMap.get(version) });
			continue;
		}

		// Attempt to enqueue — skip silently if queue is full
		const counterRes = await counter.fetch('http://do/increment');
		if (counterRes.status === 429) {
			result.push({ version, publishedAt, bytes: null });
			continue;
		}

		const jobId = crypto.randomUUID();
		try {
			await env.DB.prepare(
				`INSERT INTO bundle_jobs (id, package, version, export_path, status)
				 VALUES (?, ?, ?, ?, 'pending')`,
			)
				.bind(jobId, pkg, version, exportPath)
				.run();

			const msg: BundleJobMessage = { jobId, package: pkg, version, exportPath };
			await env.BUNDLE_QUEUE.send(msg);
			result.push({ version, publishedAt, bytes: null, jobId });
		} catch {
			await counter.fetch('http://do/decrement').catch(() => {});
			result.push({ version, publishedAt, bytes: null });
		}
	}

	return Response.json({ package: pkg, export: exportPath, versions: result });
}
