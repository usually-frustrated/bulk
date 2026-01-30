import type { Env } from './types';
import { handleBadgeRequest } from './handlers/badge';

export { Env };

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Skip favicon requests
		if (url.pathname === '/favicon.ico') {
			return new Response('Not found', { status: 404 });
		}

		return handleBadgeRequest(request, ctx);
	},
};
