import type { Env } from '../types';
import { parseBundlePath } from '../utils/bundle-parse';
import { CDNS, DEFAULT_CDN, buildCdnUrl, measureSize } from '../utils/cdn';
import type { CDN } from '../utils/cdn';
import { resolveVersion, getPackageExports, getCachedSize, saveSize } from '../utils/db';

// ─── single export ───────────────────────────────────────────────────────────

async function handleSingleExport(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
	pkg: string,
	version: string,
	exportKey: string,
	cdn: CDN,
): Promise<Response> {
	const cached = await getCachedSize(pkg, version, exportKey, cdn, env);
	if (cached) {
		return Response.json({ package: pkg, version, export: exportKey, cdn, ...cached });
	}

	const exports = await getPackageExports(pkg, version, env);
	const entry = exports.find((e) => e.key === exportKey);
	if (!entry) {
		return new Response(`Export '${exportKey}' not found in ${pkg}@${version}`, { status: 404 });
	}

	const url = buildCdnUrl(pkg, version, exportKey, entry.path, cdn);
	const size = await measureSize(url);

	ctx.waitUntil(saveSize(pkg, version, exportKey, cdn, size, env));

	return Response.json({ package: pkg, version, export: exportKey, cdn, ...size });
}

// ─── all exports (?exports) ──────────────────────────────────────────────────

async function handleAllExports(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
	pkg: string,
	version: string,
	cdn: CDN,
): Promise<Response> {
	const exports = await getPackageExports(pkg, version, env);

	const results = await Promise.all(
		exports.map(async (entry) => {
			const cached = await getCachedSize(pkg, version, entry.key, cdn, env);
			if (cached) return { key: entry.key, ...cached };

			const url = buildCdnUrl(pkg, version, entry.key, entry.path, cdn);
			try {
				const size = await measureSize(url);
				ctx.waitUntil(saveSize(pkg, version, entry.key, cdn, size, env));
				return { key: entry.key, ...size };
			} catch {
				return { key: entry.key, bytes_raw: null, bytes_transfer: null };
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

	try {
		if (wantsAllExports) {
			return await handleAllExports(request, env, ctx, pkg, version, cdnParam);
		}

		const exportKey = parsed.exportPath ?? 'index';
		return await handleSingleExport(request, env, ctx, pkg, version, exportKey, cdnParam);
	} catch (err: unknown) {
		const status = (err as { status?: number }).status ?? 502;
		return new Response(err instanceof Error ? err.message : 'CDN fetch failed', { status });
	}
}
