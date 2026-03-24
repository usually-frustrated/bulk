import type { Env } from '../types';
import { getVersionList } from '../utils/db';

// /_versions/<pkg>  — returns the version list only, no size data.
export async function handleVersionsRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

	const url = new URL(request.url);
	const pkg = decodeURIComponent(url.pathname.slice('/_versions/'.length));
	if (!pkg) return new Response('Package name required', { status: 400 });

	try {
		const versions = await getVersionList(pkg, env);
		return Response.json({ package: pkg, versions });
	} catch (err: unknown) {
		const status = (err as { status?: number }).status ?? 502;
		return new Response(err instanceof Error ? err.message : 'Failed', { status });
	}
}
