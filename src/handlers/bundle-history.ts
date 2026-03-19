import type { Env } from '../types';

interface VersionEntry {
	version: string;
	publishedAt: string;
}

export interface HistoryVersion {
	version: string;
	publishedAt: string;
	bytes: number | null;
}

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

/** One version per minor (highest patch), sorted by publish date, capped at 50. */
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

async function getVersionList(pkg: string, env: Env): Promise<VersionEntry[]> {
	const kvKey = `pkg-history:${pkg}`;
	const hit = await env.CACHE.get(kvKey);
	if (hit) return JSON.parse(hit) as VersionEntry[];

	const res = await fetch(`https://registry.npmjs.org/${pkg}`, {
		headers: { Accept: 'application/json' },
	});
	if (!res.ok) throw Object.assign(new Error(`Package not found: ${pkg}`), { status: 404 });

	const data = (await res.json()) as { time?: Record<string, string> };
	if (!data.time) throw new Error('No version history available');

	const entries = filterVersionHistory(data.time);
	await env.CACHE.put(kvKey, JSON.stringify(entries), { expirationTtl: 86400 });
	return entries;
}

async function fetchSize(pkg: string, version: string, exportPath: string): Promise<number | null> {
	try {
		const base = `https://esm.sh/${pkg}@${version}`;
		const url = exportPath === 'index' ? base : `${base}/${exportPath}`;
		const res = await fetch(url, { redirect: 'follow' });
		if (!res.ok) return null;
		return (await res.arrayBuffer()).byteLength;
	} catch {
		return null;
	}
}

export async function handleBundleHistory(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

	const parsed = parseHistoryPath(new URL(request.url).pathname);
	if (!parsed) return new Response('Invalid path', { status: 400 });

	const { package: pkg, exportPath } = parsed;

	let entries: VersionEntry[];
	try {
		entries = await getVersionList(pkg, env);
	} catch (err: unknown) {
		const status = (err as { status?: number }).status ?? 502;
		return new Response(err instanceof Error ? err.message : 'Failed', { status });
	}

	if (!entries.length) {
		return Response.json({ package: pkg, export: exportPath, versions: [] });
	}

	// Check KV cache for all versions in parallel
	const cacheKeys = entries.map((e) => `bundle:${pkg}@${e.version}:${exportPath}`);
	const cached = await Promise.all(cacheKeys.map((k) => env.CACHE.get(k)));

	// Fetch from CDN for any cache misses — all in parallel
	const misses = entries.filter((_, i) => cached[i] === null);
	const fetched = await Promise.all(misses.map((e) => fetchSize(pkg, e.version, exportPath)));

	// Write new results to KV in the background (fire and forget)
	const writes = misses
		.map((e, i) =>
			fetched[i] !== null ? env.CACHE.put(`bundle:${pkg}@${e.version}:${exportPath}`, String(fetched[i])) : null,
		)
		.filter((p): p is Promise<void> => p !== null);
	if (writes.length) ctx.waitUntil(Promise.all(writes));

	// Build final response — merge cached + freshly fetched
	const fetchedMap = new Map(misses.map((e, i) => [e.version, fetched[i]]));
	const versions: HistoryVersion[] = entries.map((e, i) => ({
		version: e.version,
		publishedAt: e.publishedAt,
		bytes: cached[i] !== null ? parseInt(cached[i]!, 10) : (fetchedMap.get(e.version) ?? null),
	}));

	return Response.json({ package: pkg, export: exportPath, versions });
}
