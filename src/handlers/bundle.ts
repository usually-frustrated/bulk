import type { Env, BundleJobMessage } from '../types';
import { parseBundlePath } from '../utils/bundle-parse';

/** Resolves `@latest` to a concrete semver via the npm registry, cached in KV. */
async function resolveVersion(pkg: string, requestedVersion: string, env: Env): Promise<string> {
	if (requestedVersion !== 'latest') return requestedVersion;

	const kvKey = `version:${pkg}:latest`;
	const cached = await env.VERSION_CACHE.get(kvKey);
	if (cached) return cached;

	const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
		headers: { Accept: 'application/json' },
	});
	if (!res.ok) {
		throw Object.assign(new Error(`Package not found: ${pkg}`), { status: 404 });
	}

	const data = (await res.json()) as { version: string };
	const version = data.version;
	// Cache for 1 hour — short enough to pick up new releases promptly
	await env.VERSION_CACHE.put(kvKey, version, { expirationTtl: 3600 });
	return version;
}

function counterStub(env: Env): DurableObjectStub {
	const id = env.QUEUE_COUNTER.idFromName('global');
	return env.QUEUE_COUNTER.get(id);
}

export async function handleBundleRequest(request: Request, env: Env): Promise<Response> {
	if (request.method !== 'GET') {
		return new Response('Method not allowed', { status: 405 });
	}

	const { pathname } = new URL(request.url);
	const parsed = parseBundlePath(pathname);
	if (!parsed) {
		return new Response('Invalid bundle path', { status: 400 });
	}

	let version: string;
	try {
		version = await resolveVersion(parsed.package, parsed.version, env);
	} catch (err: unknown) {
		const status = (err as { status?: number }).status ?? 502;
		const msg = err instanceof Error ? err.message : 'Version resolution failed';
		return new Response(msg, { status });
	}

	const { package: pkg, exportPath } = parsed;

	// 1. Permanent cache hit — return immediately
	const cached = await env.DB.prepare(
		`SELECT bytes FROM bundle_cache WHERE package = ? AND version = ? AND export_path = ?`,
	)
		.bind(pkg, version, exportPath)
		.first<{ bytes: number }>();

	if (cached) {
		return Response.json({
			package: pkg,
			version,
			export: exportPath,
			bytes: cached.bytes,
			cached: true,
		});
	}

	// 2. Dedup — return existing pending/processing job if one exists
	const existing = await env.DB.prepare(
		`SELECT id FROM bundle_jobs
		 WHERE package = ? AND version = ? AND export_path = ?
		   AND status IN ('pending', 'processing')
		 ORDER BY created_at DESC LIMIT 1`,
	)
		.bind(pkg, version, exportPath)
		.first<{ id: string }>();

	if (existing) {
		return Response.json(
			{ jobId: existing.id, statusUrl: `/_bundle-status/${existing.id}` },
			{ status: 202 },
		);
	}

	// 3. Backpressure — ask the QueueCounter DO if there's room
	const counterRes = await counterStub(env).fetch('http://do/increment');
	if (counterRes.status === 429) {
		return new Response('Queue full — try again later', { status: 429 });
	}

	// 4. Enqueue
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
	} catch (err) {
		// Roll back counter if we failed to actually enqueue
		await counterStub(env).fetch('http://do/decrement').catch(() => {});
		return new Response('Failed to enqueue job', { status: 500 });
	}

	return Response.json(
		{ jobId, statusUrl: `/_bundle-status/${jobId}` },
		{ status: 202 },
	);
}
