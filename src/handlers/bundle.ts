import type { Env } from '../types';
import { parseBundlePath } from '../utils/bundle-parse';

async function resolveVersion(pkg: string, env: Env): Promise<string> {
	const kvKey = `version:${pkg}:latest`;
	const hit = await env.CACHE.get(kvKey);
	if (hit) return hit;

	const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
		headers: { Accept: 'application/json' },
	});
	if (!res.ok) throw Object.assign(new Error(`Package not found: ${pkg}`), { status: 404 });

	const { version } = (await res.json()) as { version: string };
	await env.CACHE.put(kvKey, version, { expirationTtl: 3600 });
	return version;
}

/** Fetch a module from esm.sh and measure its uncompressed byte size. */
async function fetchSize(pkg: string, version: string, exportPath: string): Promise<number> {
	const base = `https://esm.sh/${pkg}@${version}`;
	const url = exportPath === 'index' ? base : `${base}/${exportPath}`;

	const res = await fetch(url, { redirect: 'follow' });
	if (!res.ok) {
		throw Object.assign(new Error(`esm.sh returned ${res.status} for ${url}`), {
			status: res.status === 404 ? 404 : 502,
		});
	}

	return (await res.arrayBuffer()).byteLength;
}

export async function handleBundleRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

	const parsed = parseBundlePath(new URL(request.url).pathname);
	if (!parsed) return new Response('Invalid bundle path', { status: 400 });

	let { version } = parsed;
	const { package: pkg, exportPath } = parsed;

	try {
		if (version === 'latest') version = await resolveVersion(pkg, env);
	} catch (err: unknown) {
		const status = (err as { status?: number }).status ?? 502;
		return new Response(err instanceof Error ? err.message : 'Version resolution failed', { status });
	}

	// KV cache — versioned results are immutable so we store them indefinitely
	const cacheKey = `bundle:${pkg}@${version}:${exportPath}`;
	const hit = await env.CACHE.get(cacheKey);
	if (hit) {
		return Response.json(
			{ package: pkg, version, export: exportPath, bytes: parseInt(hit, 10), cdn: 'esm.sh' },
			{ headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
		);
	}

	let bytes: number;
	try {
		bytes = await fetchSize(pkg, version, exportPath);
	} catch (err: unknown) {
		const status = (err as { status?: number }).status ?? 502;
		return new Response(err instanceof Error ? err.message : 'CDN fetch failed', { status });
	}

	ctx.waitUntil(env.CACHE.put(cacheKey, String(bytes)));

	return Response.json(
		{ package: pkg, version, export: exportPath, bytes, cdn: 'esm.sh' },
		{ headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
	);
}
