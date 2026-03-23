import type { Env } from './types';
import { handleBadgeRequest } from './handlers/badge';
import { handleBundleRequest } from './handlers/bundle';
import { handleBundleHistory } from './handlers/bundle-history';
import { handleDiscoverRequest } from './handlers/discover';
import { handleRecordRequest } from './handlers/measurement';
import { handleBannerRequest } from './handlers/banner';
import { handleMetaVersionRequest } from './handlers/meta-version';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const { pathname } = new URL(request.url);

		if (pathname === '/favicon.ico') {
			return new Response('Not found', { status: 404 });
		}

		if (pathname.startsWith('/_bundle-history/')) {
			return handleBundleHistory(request, env, ctx);
		}

		if (pathname.startsWith('/_bundle/')) {
			return handleBundleRequest(request, env, ctx);
		}

		if (pathname.startsWith('/_discover/')) {
			return handleDiscoverRequest(request, env, ctx);
		}

		if (pathname === '/_record') {
			return handleRecordRequest(request, env, ctx);
		}

		if (pathname === '/_meta/version') {
			return handleMetaVersionRequest(request, env, ctx);
		}

		if (pathname.startsWith('/_banner/')) {
			return handleBannerRequest(request, env, ctx);
		}

		if (pathname.startsWith('/_/')) {
			return env.ASSETS.fetch(request);
		}

		return handleBadgeRequest(request, ctx);
	},
};
