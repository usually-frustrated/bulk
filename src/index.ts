import type { Env, BundleJobMessage } from './types';
import { handleBadgeRequest } from './handlers/badge';
import { handleBundleRequest } from './handlers/bundle';
import { handleBundleStatus } from './handlers/bundle-status';
import { handleQueue } from './workers/bundler-queue';

export { QueueCounter } from './durable-objects/queue-counter';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const { pathname } = new URL(request.url);

		if (pathname === '/favicon.ico') {
			return new Response('Not found', { status: 404 });
		}

		// Bundle status polling / SSE — check before static assets
		if (pathname.startsWith('/_bundle-status/')) {
			return handleBundleStatus(request, env);
		}

		// Bundle size endpoint — check before static assets
		if (pathname.startsWith('/_bundle/')) {
			return handleBundleRequest(request, env);
		}

		// Static assets (CSS, JS, HTML for the SPA)
		if (pathname.startsWith('/_/')) {
			return env.ASSETS.fetch(request);
		}

		return handleBadgeRequest(request, ctx);
	},

	async queue(batch: MessageBatch<BundleJobMessage>, env: Env): Promise<void> {
		return handleQueue(batch, env);
	},
};
