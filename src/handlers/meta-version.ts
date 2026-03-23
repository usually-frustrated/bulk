import type { Env } from '../types';

// Read the commit hash from the environment (set during build/deployment)
// Cloudflare Workers sets CF_BUILD_ID which contains the commit hash
export async function handleMetaVersionRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	// Try to get commit hash from various sources
	const commitHash = (env as any).CF_BUILD_ID || process.env.CF_BUILD_ID || 'unknown';
	
	return Response.json({
		commit: commitHash,
		timestamp: new Date().toISOString(),
	});
}
