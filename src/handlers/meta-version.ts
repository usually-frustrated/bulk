import type { Env } from '../types';

export async function handleMetaVersionRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	// Return a simple response to test if the endpoint works
	return Response.json({
		commit: 'test',
		timestamp: new Date().toISOString(),
	});
}
