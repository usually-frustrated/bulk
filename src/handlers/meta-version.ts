import type { Env } from '../types';

// Commit hash is set during build via git rev-parse
// Cloudflare Workers doesn't provide CF_BUILD_ID, so we hardcode it
const COMMIT_HASH = 'd6c9264';

export async function handleMetaVersionRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	return Response.json({
		commit: COMMIT_HASH,
		timestamp: new Date().toISOString(),
	});
}
