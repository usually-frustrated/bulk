import { formatSize } from '../utils/size';
import { generateBadgeSvg, type BadgeStats } from '../utils/svg';
import { buildCacheControl, parsePath, type ParsedPath } from '../utils/pkg';
import { getProvider, getDefaultProvider, type Provider } from '../providers';
import { Telemetry } from '../utils/telemetry';
import { resolveVersion, getMeasuredSizeFromWaterfall, getPackageExports, getLatestWaterfall } from '../utils/db';
import { DEFAULT_CDN } from '../utils/cdn';
import type { Confidence, CDN } from '../utils/cdn';
import type { Env } from '../types';

interface FetchResult {
	sizeStr: string;
	confidence: Confidence;
}

async function fetchPackageSize(provider: Provider, pkg: string): Promise<FetchResult> {
	try {
		const startTime = Date.now();
		const url = provider.url(pkg);

		Telemetry.info('Fetching package size', {
			provider: provider.id,
			package: pkg,
			url,
		});

		const res = await fetch(url, {
			method: 'GET',
			headers: {
				'User-Agent': 'Cloudflare-Worker-Badge-Service',
				Accept: '*/*',
			},
		});

		const duration = Date.now() - startTime;

		if (!res.ok) {
			const errorText = await res.text();
			Telemetry.warn('Package not found', {
				provider: provider.id,
				package: pkg,
				status: res.status,
				statusText: res.statusText,
				errorBody: errorText,
				duration,
			});
			return { sizeStr: 'not found', confidence: 'no-data' };
		}

		const contentLength = res.headers.get('content-length');
		let bytes = 0;

		if (contentLength) {
			bytes = parseInt(contentLength);
		} else {
			// If no content-length header, we need to download and measure
			const buffer = await res.arrayBuffer();
			bytes = buffer.byteLength;
		}

		Telemetry.info('Package size fetched', {
			provider: provider.id,
			package: pkg,
			bytes,
			contentLength,
			hasContentLength: !!contentLength,
			duration,
		});
		return { sizeStr: formatSize(bytes), confidence: 'server-estimate' };
	} catch (error) {
		Telemetry.error('Failed to fetch package size', {
			provider: provider.id,
			package: pkg,
			error: error instanceof Error ? error.message : String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
		});
		return { sizeStr: 'error', confidence: 'no-data' };
	}
}

// Cache version - increment this to invalidate all caches on deployment
const CACHE_VERSION = 'v5';

export async function handleBadgeRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const requestStartTime = Date.now();
	const url = new URL(request.url);
	const parsed = parsePath(url.pathname);

	// Log incoming request (non-blocking)
	ctx.waitUntil(
		Telemetry.logAsync(ctx, 'info', 'Badge request received', {
			url: url.pathname,
			hostname: url.hostname,
			method: request.method,
		}),
	);

	if (!parsed) {
		ctx.waitUntil(
			Telemetry.logAsync(ctx, 'warn', 'Invalid path, redirecting to home', {
				pathname: url.pathname,
			}),
		);
		return Response.redirect('/', 302);
	}

	const { provider: providerId, pkg } = parsed;
	const provider = getProvider(providerId) || getDefaultProvider();

	// Check for force refresh parameter
	const forceRefresh = url.searchParams.has('refresh');

	const isLocal = url.hostname === 'localhost';
	// Version the cache key to allow cache invalidation between deployments
	const cacheUrl = new URL(url.toString());
	cacheUrl.searchParams.delete('refresh'); // Remove refresh param from cache key
	cacheUrl.searchParams.set('cache_v', CACHE_VERSION);
	const cacheKey = new Request(cacheUrl.toString(), request);
	const cache = caches.default;

	let cacheHit = false;
	if (!isLocal && !forceRefresh) {
		const cached = await cache.match(cacheKey);
		if (cached) {
			cacheHit = true;
			ctx.waitUntil(
				Telemetry.logAsync(ctx, 'info', 'Cache hit', {
					provider: providerId,
					package: pkg,
					duration: Date.now() - requestStartTime,
				}),
			);
			return cached;
		}
	}

	if (forceRefresh) {
		ctx.waitUntil(
			Telemetry.logAsync(ctx, 'info', 'Force refresh requested', {
				provider: providerId,
				package: pkg,
			}),
		);
	}

	// ── try browser-measured P50 first ──────────────────────────────────────
	let sizeStr: string;
	let confidence: Confidence;
	let stats: BadgeStats | undefined;

	// Extract bare package name (strip @version suffix if present, being careful
	// with scoped packages like @scope/pkg where the @ is at position 0).
	const atIdx = pkg.lastIndexOf('@');
	const pkgName = atIdx > 0 ? pkg.slice(0, atIdx) : pkg;
	const pkgVersion = atIdx > 0 ? pkg.slice(atIdx + 1) : null;

	// Map the provider ID to a CDN type used in the database; fall back to DEFAULT_CDN
	// for legacy providers (skypack) that don't have a CDN equivalent.
	const cdn = (['jsdelivr', 'esm.sh', 'unpkg'] as CDN[]).includes(providerId as CDN)
		? providerId as CDN
		: DEFAULT_CDN;

	try {
		const version = pkgVersion ?? await resolveVersion(pkgName, env);
		const measured = await getMeasuredSizeFromWaterfall(pkgName, version, 'index', cdn, env);
		if (measured) {
			sizeStr = formatSize(measured.bytes_raw ?? 0);
			confidence = measured.confidence;
		} else {
			// Not enough browser samples — fall back to HEAD estimate.
			({ sizeStr, confidence } = await fetchPackageSize(provider, pkg));
		}

		// Package identity always available — start stats here, enrich below.
		stats = { pkgName, version, format: 'ESM' };

		// Best-effort: enrich badge with export count + waterfall stats
		try {
			const [pkgExports, waterfall] = await Promise.all([
				getPackageExports(pkgName, version, env),
				getLatestWaterfall(pkgName, version, 'index', cdn, env),
			]);
			const exportCount = pkgExports.length || undefined;
			let fileCount: number | undefined;
			let roundTrips: number | undefined;
			if (waterfall.length > 0) {
				fileCount  = waterfall.length;
				roundTrips = Math.max(...waterfall.map(r => r.round_trip)) + 1;
			}
			stats = { ...stats, exportCount, fileCount, roundTrips };
		} catch {}
	} catch {
		// Version resolution or db failure — fall back gracefully.
		({ sizeStr, confidence } = await fetchPackageSize(provider, pkg));
	}

	const svg = generateBadgeSvg(provider.name, sizeStr!, confidence!, stats);

	const response = new Response(svg, {
		headers: {
			'Content-Type': 'image/svg+xml',
			'Cache-Control': buildCacheControl(pkg),
			'Access-Control-Allow-Origin': '*',
		},
	});

	if (!isLocal) {
		ctx.waitUntil(cache.put(cacheKey, response.clone()));
	}

	// Log successful response (non-blocking)
	const totalDuration = Date.now() - requestStartTime;
	ctx.waitUntil(
		Telemetry.logAsync(ctx, 'info', 'Badge request completed', {
			provider: providerId,
			package: pkg,
			cacheHit,
			confidence,
			sizeStr,
			duration: totalDuration,
		}),
	);

	return response;
}
