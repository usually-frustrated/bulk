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

		// Serve static assets from the /_/ namespace directly, bypassing badge routing
		if (url.pathname.startsWith('/_/')) {
			return env.ASSETS.fetch(request);
		}

		return handleBadgeRequest(request, ctx);
	},
};
