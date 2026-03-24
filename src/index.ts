import type { Env } from './types';
import { handleBadgeRequest } from './handlers/badge';
import { handleBundleRequest } from './handlers/bundle';
import { handleBundleHistory } from './handlers/bundle-history';
import { handleDiscoverRequest } from './handlers/discover';
import { handleRecordRequest } from './handlers/measurement';
import { handleBannerRequest } from './handlers/banner';
import { handleClearCache } from './handlers/clear-cache';

// ─── Route hierarchy ──────────────────────────────────────────────────────────
//
//  /favicon.ico           → 404  (prevent catch-all from treating it as a pkg)
//  /_/<static>            → CF ASSETS  (CSS, JS, images — served before API)
//
//  ── Analysis API ──────────────────────────────────────────────────────────
//  /_bundle-history/<pkg>[/<export>]   → bundle size history across versions
//  /_bundle/<pkg>[@ver][/<export>]     → single / all-export bundle sizes
//  /_discover/<pkg>                    → export discovery from package.json
//  /_record   (POST)                   → record browser resource timings
//
//  ── Utility ───────────────────────────────────────────────────────────────
//  /_banner/<pkg>                      → OG-style banner image
//  /_clear/<pkg>                       → invalidate cached sizes for a pkg
//
//  ── Catch-all ─────────────────────────────────────────────────────────────
//  /*                                  → SVG badge  (npm package size badge)
//
// Notes:
//  • /_/ is the reserved static namespace; npm pkg names never start with `_`.
//  • /_bundle-history/ must be checked before /_bundle/ (prefix collision).
//  • Cache writes and telemetry use ctx.waitUntil (non-blocking, best-effort).
// ─────────────────────────────────────────────────────────────────────────────

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const { pathname } = new URL(request.url);

		// ── Special cases ──────────────────────────────────────────────────────
		if (pathname === '/favicon.ico') {
			return new Response('Not found', { status: 404 });
		}

		// ── Static assets (/_/<file>) ──────────────────────────────────────────
		if (pathname.startsWith('/_/')) {
			return env.ASSETS.fetch(request);
		}

		// ── Analysis API ───────────────────────────────────────────────────────
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

		// ── Utility ────────────────────────────────────────────────────────────
		if (pathname.startsWith('/_banner/')) {
			return handleBannerRequest(request, env, ctx);
		}

		if (pathname.startsWith('/_clear/')) {
			return handleClearCache(request, env, ctx);
		}

		// ── Badge catch-all ────────────────────────────────────────────────────
		return handleBadgeRequest(request, env, ctx);
	},
};
