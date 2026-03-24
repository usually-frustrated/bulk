import type { Env } from '../types';
import { parseBundlePath } from '../utils/bundle-parse';
import { CDNS, DEFAULT_CDN, buildCdnUrl, measureSize } from '../utils/cdn';
import type { CDN } from '../utils/cdn';
import { resolveVersion, getPackageExports, getCachedSize, saveSize, getMeasuredSize } from '../utils/db';
import { expandWildcardExports } from '../utils/wildcard';

// ─── single export ───────────────────────────────────────────────────────────

async function handleSingleExport(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
	pkg: string,
	version: string,
	exportKey: string,
	cdn: CDN,
	refresh: boolean = false,
): Promise<Response> {
	// Prefer real browser P50 measurements over cached HEAD estimates.
	// Wrapped in try/catch so a missing resource_timings table falls through gracefully.
	try {
		const browserSize = await getMeasuredSize(pkg, version, exportKey, cdn, env);
		if (browserSize) {
			return Response.json({ package: pkg, version, export: exportKey, cdn, ...browserSize });
		}
	} catch {}

	if (!refresh) {
		const cached = await getCachedSize(pkg, version, exportKey, cdn, env);
		if (cached) {
			return Response.json({
				package: pkg, version, export: exportKey, cdn,
				...cached, confidence: 'server-estimate',
			});
		}
	}

	const exports = await getPackageExports(pkg, version, env);
	const entry = exports.find((e) => e.key === exportKey);
	if (!entry) {
		return new Response(`Export '${exportKey}' not found in ${pkg}@${version}`, { status: 404 });
	}

	const url = buildCdnUrl(pkg, version, exportKey, entry.path, cdn);
	const size = await measureSize(url);
	ctx.waitUntil(saveSize(pkg, version, exportKey, cdn, size, env));

	return Response.json({
		package: pkg, version, export: exportKey, cdn,
		...size, confidence: 'server-estimate',
	});
}

// ─── all exports (?exports) ──────────────────────────────────────────────────

async function handleAllExports(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
	pkg: string,
	version: string,
	cdn: CDN,
	refresh: boolean = false,
): Promise<Response> {
	const rawExports = await getPackageExports(pkg, version, env);
	// Expand wildcard export keys (e.g. "*" → individual files) before measuring.
	const exports = await expandWildcardExports(rawExports, pkg, version);

	const results = await Promise.all(
		exports.map(async (entry) => {
			try {
				// Prefer real browser P50 measurements over HEAD estimates.
				// Wrapped in try/catch so a missing resource_timings table falls through.
				let browserSize = null;
				try {
					browserSize = await getMeasuredSize(pkg, version, entry.key, cdn, env);
				} catch {}
				if (browserSize) return { key: entry.key, ...browserSize };

				if (!refresh) {
					const cached = await getCachedSize(pkg, version, entry.key, cdn, env);
					if (cached) return { key: entry.key, ...cached, confidence: 'server-estimate' };
				}

				const url = buildCdnUrl(pkg, version, entry.key, entry.path, cdn);
				const size = await measureSize(url);
				ctx.waitUntil(saveSize(pkg, version, entry.key, cdn, size, env));
				return { key: entry.key, ...size, confidence: 'server-estimate' };
			} catch {
				return { key: entry.key, bytes_raw: null, bytes_transfer: null, confidence: 'no-data' };
			}
		}),
	);

	// Sort by best available size, nulls last
	results.sort((a, b) => {
		const sa = a.bytes_transfer ?? a.bytes_raw ?? Infinity;
		const sb = b.bytes_transfer ?? b.bytes_raw ?? Infinity;
		return sa - sb;
	});

	return Response.json({ package: pkg, version, cdn, exports: results });
}

// ─── main handler ────────────────────────────────────────────────────────────

export async function handleBundleRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

	const url = new URL(request.url);
	const parsed = parseBundlePath(url.pathname);
	if (!parsed) return new Response('Invalid bundle path', { status: 400 });

	const cdnParam = (url.searchParams.get('cdn') ?? DEFAULT_CDN) as CDN;
	if (!CDNS.includes(cdnParam)) {
		return new Response(`Unknown CDN. Valid values: ${CDNS.join(', ')}`, { status: 400 });
	}

	let { version } = parsed;
	try {
		if (version === 'latest') version = await resolveVersion(parsed.package, env);
	} catch (err: unknown) {
		const status = (err as { status?: number }).status ?? 502;
		return new Response(err instanceof Error ? err.message : 'Version resolution failed', { status });
	}

	const pkg = parsed.package;
	const wantsAllExports = url.searchParams.has('exports');
	const refresh = url.searchParams.has('refresh');

	try {
		if (wantsAllExports) {
			return await handleAllExports(request, env, ctx, pkg, version, cdnParam, refresh);
		}

		const exportKey = parsed.exportPath ?? 'index';
		return await handleSingleExport(request, env, ctx, pkg, version, exportKey, cdnParam, refresh);
	} catch (err: unknown) {
		const status = (err as { status?: number }).status ?? 502;
		return new Response(err instanceof Error ? err.message : 'CDN fetch failed', { status });
	}
}
