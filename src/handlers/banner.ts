import type { Env } from '../types';
import { generateStandardBanner, generateFullBanner, generateBadgeSvg, formatSize } from '../utils/svg';
import { resolveVersion, getPackageExports, getCachedSize, getMeasuredSize } from '../utils/db';
import { buildCdnUrl, measureSize } from '../utils/cdn';
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
			if (bytes === null) {
				// Measure live (fire-and-forget save)
				try {
					const indexEntry = exports.find(e => e.key === 'index') ?? exports[0];
					if (indexEntry) {
						const cdnUrl = buildCdnUrl(pkg, version, indexEntry.key, indexEntry.path, cdn);
						const result = await measureSize(cdnUrl);
						bytes = result.bytes_transfer ?? result.bytes_raw ?? null;
					}
				} catch {}
			}

			const svg = generateStandardBanner({
				pkg, version, cdn,
				bytes,
				exportCount,
				hasEsm,
				hasUmd,
				isError: false,
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
