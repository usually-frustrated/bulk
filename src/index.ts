import type { Env } from './types';
import { handleBadgeRequest } from './handlers/badge';
import { handleBundleRequest } from './handlers/bundle';
import { handleBundleHistory } from './handlers/bundle-history';
import { handleDiscoverRequest } from './handlers/discover';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const { pathname } = new URL(request.url);

		if (pathname === '/favicon.ico') {
			return new Response('Not found', { status: 404 });
		}

		if (pathname.startsWith('/_discover/')) {
			return handleDiscoverRequest(request, env, ctx);
		}

		if (pathname.startsWith('/_bundle-history/')) {
			return handleBundleHistory(request, env, ctx);
		}

		if (pathname.startsWith('/_bundle/')) {
			return handleBundleRequest(request, env, ctx);
		}

		if (pathname.startsWith('/_/')) {
			if (env.ASSETS) {
				return env.ASSETS.fetch(request);
			}
			// Dev mode fallback - try to serve from public folder
			const filePath = pathname.slice(2);
			const mimeTypes: Record<string, string> = {
				'html': 'text/html',
				'css': 'text/css',
				'js': 'application/javascript',
				'png': 'image/png',
				'ico': 'image/x-icon',
				'svg': 'image/svg+xml',
			};
			const ext = filePath.split('.').pop() || '';
			const contentType = mimeTypes[ext] || 'text/plain';
			return new Response(`File not found: ${filePath}`, { status: 404 });
		}

		return handleBadgeRequest(request, ctx);
	},
};
