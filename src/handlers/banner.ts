import type { Env } from '../types';
import type { BannerResource } from '../utils/svg';
import { generateStandardBanner, generateFullBanner, generateBadgeSvg, formatSize } from '../utils/svg';
import { resolveVersion, getPackageExports, getCachedSize, getMeasuredSizeFromWaterfall, getLatestWaterfall } from '../utils/db';
import type { CDN } from '../utils/cdn';


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
			let bytes: number | null = null;
			let confidence: 'established' | 'tentative' | 'server-estimate' = 'server-estimate';
			try {
				const ms = await getMeasuredSizeFromWaterfall(pkg, version, 'index', cdn, env);
				if (ms) { bytes = ms.bytes_raw ?? null; confidence = ms.confidence; }
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
			// Fetch the latest structural waterfall from the database.
			// It carries pre-computed round_trip indices and decoded byte sizes.
			let bytes: number | null = null;
			let fileCount: number | undefined;
			let roundTrips: number | undefined;
			let resources: BannerResource[] | undefined;
			try {
				const wf = await getLatestWaterfall(pkg, version, 'index', cdn, env);
				if (wf.length > 0) {
					resources  = wf.map((r) => ({ url: r.url, roundTrip: r.round_trip, bytes: r.bytes }));
					fileCount  = resources.length;
					roundTrips = Math.max(...resources.map((r) => r.roundTrip)) + 1;
					// Derive total size as sum of all file bytes in the waterfall
					const total = resources.reduce<number | null>((acc, r) => {
						if (acc === null || r.bytes === null) return null;
						return acc + r.bytes;
					}, 0);
					bytes = total;
				}
			} catch {}
			// Fall back to server-estimated size if no waterfall data
			if (bytes === null) {
				try {
					const cs = await getCachedSize(pkg, version, 'index', cdn, env);
					if (cs) bytes = cs.bytes_transfer ?? cs.bytes_raw ?? null;
				} catch {}
			}

			const svg = generateStandardBanner({
				pkg, version, cdn,
				bytes,
				exportCount,
				hasEsm,
				hasUmd,
				isError: false,
				fileCount,
				roundTrips,
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
						const ms = await getMeasuredSizeFromWaterfall(pkg, version, e.key, cdn, env);
						if (ms) bytes = ms.bytes_raw ?? null;
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
