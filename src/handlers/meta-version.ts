import type { Env } from '../types';

// Read the commit hash from the environment (set during build/deployment)
// Cloudflare Workers sets CF_BUILD_ID which contains the commit hash
export async function handleMetaVersionRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const commitHash = process.env.CF_BUILD_ID || 'unknown';
	
	return Response.json({
		commit: commitHash,
		timestamp: new Date().toISOString(),
	});
}
