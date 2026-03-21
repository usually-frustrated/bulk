import type { Env } from '../types';
import { DEFAULT_CDN, CDNS, buildCdnUrl, measureSize } from '../utils/cdn';
import type { CDN } from '../utils/cdn';
import { getVersionList, getCachedSizesBatch, saveSize } from '../utils/db';

export interface HistoryVersion {
	version: string;
	publishedAt: string;
	bytes_raw: number | null;
	bytes_transfer: number | null;
}

// /_bundle-history/<pkg>[/<exportKey>]
function parseHistoryPath(pathname: string): { package: string; exportKey: string } | null {
	const prefix = '/_bundle-history/';
	if (!pathname.startsWith(prefix)) return null;
	const rest = pathname.slice(prefix.length);
	if (!rest) return null;

	if (rest.startsWith('@')) {
		const match = rest.match(/^(@[^/@][^/]*\/[^/]+)(?:\/(.+))?$/);
		if (!match) return null;
		return { package: match[1], exportKey: match[2] ?? 'index' };
	}

	const slash = rest.indexOf('/');
	return slash === -1
		? { package: rest, exportKey: 'index' }
		: { package: rest.slice(0, slash), exportKey: rest.slice(slash + 1) };
}

export async function handleBundleHistory(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

	const url = new URL(request.url);
	const parsed = parseHistoryPath(url.pathname);
	if (!parsed) return new Response('Invalid path', { status: 400 });

	const cdnParam = (url.searchParams.get('cdn') ?? DEFAULT_CDN) as CDN;
	if (!CDNS.includes(cdnParam)) {
		return new Response(`Unknown CDN. Valid values: ${CDNS.join(', ')}`, { status: 400 });
	}

	const { package: pkg, exportKey } = parsed;

	let entries;
	try {
		entries = await getVersionList(pkg, env);
	} catch (err: unknown) {
		const status = (err as { status?: number }).status ?? 502;
		return new Response(err instanceof Error ? err.message : 'Failed', { status });
	}

	if (!entries.length) {
		return Response.json({ package: pkg, export: exportKey, cdn: cdnParam, versions: [] });
	}

	// We need the resolved file path for each version to build CDN URLs for
	// jsdelivr/unpkg. For esm.sh, the export key is enough. To keep things
	// simple for history (50 versions × package.json fetches would be slow),
	// we use the export key directly for esm.sh, and a best-effort path
	// (./exportKey.js) for other CDNs. Accurate paths are resolved per-version
	// in the ?exports endpoint where we have the full package.json.
	function guessPath(key: string): string {
		return key === 'index' ? './index.js' : `./${key}.js`;
	}

	const versions = entries.map((e) => e.version);
	const cached = await getCachedSizesBatch(pkg, versions, exportKey, cdnParam, env);

	const misses = entries.filter((e) => !cached.has(e.version));

	// Fetch all cache misses in parallel
	const fetched = await Promise.all(
		misses.map(async (e) => {
			const cdnUrl = buildCdnUrl(pkg, e.version, exportKey, guessPath(exportKey), cdnParam);
			try {
				return await measureSize(cdnUrl);
			} catch {
				return { bytes_raw: null, bytes_transfer: null };
			}
		}),
	);

	// Persist new results in the background
	const writes = misses
		.map((e, i) => {
			const s = fetched[i];
			return s.bytes_raw != null || s.bytes_transfer != null
				? saveSize(pkg, e.version, exportKey, cdnParam, s, env)
				: null;
		})
		.filter((p): p is Promise<void> => p !== null);

	if (writes.length) ctx.waitUntil(Promise.all(writes));

	const fetchedMap = new Map(misses.map((e, i) => [e.version, fetched[i]]));

	const result: HistoryVersion[] = entries.map((e) => {
		const s = cached.get(e.version) ?? fetchedMap.get(e.version) ?? { bytes_raw: null, bytes_transfer: null };
		return { version: e.version, publishedAt: e.publishedAt, ...s };
	});

	return Response.json({ package: pkg, export: exportKey, cdn: cdnParam, versions: result });
}
