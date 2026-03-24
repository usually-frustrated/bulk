import type { Env } from '../types';

export async function handleClearCache(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	if (request.method !== 'POST') {
		return new Response('Method not allowed', { status: 405 });
	}

	const url = new URL(request.url);
	const pathname = url.pathname;
	
	// Extract package name from /_clear/{package}
	const segments = pathname.split('/');
	if (segments.length < 3) {
		return new Response('Package name required', { status: 400 });
	}

	const pkg = decodeURIComponent(segments[2]);
	
	try {
		// Clear package_exports cache
		await env.DB.prepare(
			`DELETE FROM package_exports WHERE package = ?`
		).bind(pkg).run();

		// Clear cdn_sizes cache
		await env.DB.prepare(
			`DELETE FROM cdn_sizes WHERE package = ?`
		).bind(pkg).run();

		// Clear version_resolution cache
		await env.DB.prepare(
			`DELETE FROM version_resolution WHERE package = ?`
		).bind(pkg).run();

		return Response.json({
			success: true,
			message: `Cache cleared for ${pkg}`,
			cleared: {
				package_exports: true,
				cdn_sizes: true,
				version_resolution: true
			}
		});
	} catch (err) {
		return Response.json({
			success: false,
			error: err instanceof Error ? err.message : 'Unknown error'
		}, { status: 500 });
	}
}