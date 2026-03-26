import type { Env } from '../types';
import { generateStandardBanner, generateFullBanner, generateBadgeSvg, formatSize } from '../utils/svg';
import { resolveVersion, getPackageExports, getCachedSize, getMeasuredSize, getLatestResourceTimings } from '../utils/db';
import type { CDN } from '../utils/cdn';

/**
 * Returns true if the resource URL belongs to the primary package being measured,
 * not a transitive dependency loaded by the CDN.
 *
 * CDNs like esm.sh load external deps (react, react-dom, cookie, …) as separate
 * HTTP requests alongside the package itself. We never want those in the banner
 * analysis — only files that are part of the package being measured.
 *
 * Keeps:
 *  • URLs that contain the package's own name (e.g. "react-router-dom")
 *  • CDN-generated chunk files (chunk-XXXXXXX.mjs) which are internal splits
 *    of the primary package bundle, not separate packages
 * Drops:
 *  • URLs containing a different package name / version range operators
 */
function isOwnResource(url: string, pkg: string): boolean {
	// Strip @scope/ prefix so "@scope/name" → "name" for URL substring matching
	const pkgBase = pkg.startsWith('@')
		? pkg.split('/').slice(1).join('/').toLowerCase()
		: pkg.toLowerCase();
	const lurl = url.toLowerCase();
	if (lurl.includes(pkgBase)) return true;
	// Keep CDN-internal chunk files (no external package name in their path segment)
	try {
		const seg = new URL(url).pathname.split('/').pop() ?? '';
		if (/^chunk-[a-z0-9]+\.m?js$/i.test(seg)) return true;
	} catch {}
	return false;
}

export async function handleBannerRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;

	// Parse path: /_banner/(compact|standard|full)/:pkg[@version][/:export]
	const match = path.match(/^\/_banner\/(compact|standard|full)\/(.+)/);
	if (!match) {
		return new Response('Invalid banner path', { status: 400 });
	}

	const [_, type, pkgSpec] = match;

	// Parse pkg@version (handle scoped packages like @scope/name@version)
	let pkg: string;
	let versionHint = 'latest';
	if (pkgSpec.startsWith('@')) {
		// @scope/name or @scope/name@version
		const withoutLeading = pkgSpec.slice(1);
		const atIdx = withoutLeading.indexOf('@');
		if (atIdx !== -1) {
			pkg = `@${withoutLeading.slice(0, atIdx)}`;
			versionHint = withoutLeading.slice(atIdx + 1);
		} else {
			pkg = pkgSpec;
		}
	} else {
		const atIdx = pkgSpec.indexOf('@');
		if (atIdx !== -1) {
			pkg = pkgSpec.slice(0, atIdx);
			versionHint = pkgSpec.slice(atIdx + 1);
		} else {
			pkg = pkgSpec;
		}
	}

	const cdn: CDN = (url.searchParams.get('cdn') as CDN | null) ?? 'jsdelivr';
	let version = versionHint;

	try {
		// Resolve version
		version = versionHint === 'latest'
			? await resolveVersion(pkg, env)
			: versionHint;

		if (type === 'compact') {
			// Try to get size from DB first, then measure
			let bytes: number | null = null;
			let confidence: 'established' | 'server-estimate' = 'server-estimate';
			try {
				const ms = await getMeasuredSize(pkg, version, 'index', cdn, env);
				if (ms) { bytes = ms.bytes_transfer ?? ms.bytes_raw ?? null; confidence = 'established'; }
			} catch {}
			if (bytes === null) {
				try {
					const cs = await getCachedSize(pkg, version, 'index', cdn, env);
					if (cs) bytes = cs.bytes_transfer ?? cs.bytes_raw ?? null;
				} catch {}
			}
			const sizeStr = bytes !== null ? formatSize(bytes) : '—';
			const svg = generateBadgeSvg(`${pkg}@${version}`, sizeStr, confidence);
			return new Response(svg, {
				headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' },
			});
		}

		// Get exports
		const exports = await getPackageExports(pkg, version, env);
		const exportCount = exports.length;
		const hasEsm = true; // all packages via jsDelivr/esm.sh expose ESM
		const hasUmd = false; // we don't check UMD here; keep simple

		if (type === 'standard') {
			// Get index export size
			let bytes: number | null = null;
			try {
				const ms = await getMeasuredSize(pkg, version, 'index', cdn, env);
				if (ms) bytes = ms.bytes_transfer ?? ms.bytes_raw ?? null;
			} catch {}
			if (bytes === null) {
				try {
					const cs = await getCachedSize(pkg, version, 'index', cdn, env);
					if (cs) bytes = cs.bytes_transfer ?? cs.bytes_raw ?? null;
				} catch {}
			}
			// Fetch per-resource timings from the latest browser measurement session
			// so the banner can render a network waterfall.
			let fileCount: number | undefined;
			let roundTrips: number | undefined;
			let durationMs: number | undefined;
			let resources: Array<{ url: string; startTime: number; responseEnd: number; transferSize: number | null }> | undefined;
			try {
				const timings = await getLatestResourceTimings(pkg, version, 'index', cdn, env);
				// Filter to the package's own resources — exclude transitive deps the CDN
				// loads as separate requests (react, react-dom, cookie, etc.)
				const ownTimings = timings.filter((t) => isOwnResource(t.url, pkg));
				if (ownTimings.length > 0) {
					resources = ownTimings.map((t) => ({
						url:          t.url,
						startTime:    t.start_time,
						responseEnd:  t.response_end,
						transferSize: t.transfer_size,
					}));
					fileCount = resources.length;
					// Compute round trips from timing gaps (>5 ms = new round)
					const sorted = [...resources].sort((a, b) => a.startTime - b.startTime);
					let trips = 1;
					for (let i = 1; i < sorted.length; i++) {
						if (sorted[i].startTime - sorted[i - 1].startTime > 5) trips++;
					}
					roundTrips = trips;
					const t0   = Math.min(...sorted.map((r) => r.startTime));
					const tMax = Math.max(...sorted.map((r) => r.responseEnd));
					durationMs = tMax - t0;
				}
			} catch {}

			const svg = generateStandardBanner({
				pkg, version, cdn,
				bytes,
				exportCount,
				hasEsm,
				hasUmd,
				isError: false,
				fileCount,
				roundTrips,
				durationMs,
				resources,
			});
			return new Response(svg, {
				headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' },
			});
		}

		if (type === 'full') {
			// Get sizes for all exports
			const exportRows = await Promise.all(
				exports.map(async (e) => {
					let bytes: number | null = null;
					try {
						const ms = await getMeasuredSize(pkg, version, e.key, cdn, env);
						if (ms) bytes = ms.bytes_transfer ?? ms.bytes_raw ?? null;
					} catch {}
					if (bytes === null) {
						try {
							const cs = await getCachedSize(pkg, version, e.key, cdn, env);
							if (cs) bytes = cs.bytes_transfer ?? cs.bytes_raw ?? null;
						} catch {}
					}
					return { key: e.key, cdn, bytes, isError: false };
				}),
			);

			const svg = generateFullBanner({ pkg, version, exports: exportRows });
			return new Response(svg, {
				headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' },
			});
		}
	} catch (err) {
		// On any error, return a placeholder error banner
		const msg = err instanceof Error ? err.message : 'error';
		const svg = generateStandardBanner({
			pkg, version: '?', cdn,
			bytes: null,
			exportCount: 0,
			hasEsm: false,
			hasUmd: false,
			isError: true,
			errorMsg: msg.slice(0, 40),
		});
		return new Response(svg, {
			headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=60' },
		});
	}

	return new Response('Unsupported banner type', { status: 400 });
}
