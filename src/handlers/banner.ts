import type { Env } from '../types';
import { generateStandardBanner, generateFullBanner, generateBadgeSvg, formatSize } from '../utils/svg';

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
	
	const [_, type, pkgSpec, exportPath] = match;
	const pkg = pkgSpec.split('@')[0];
	const version = pkgSpec.split('@')[1] || 'latest';
	
	// For now, use placeholder data since we don't have full export measurement yet
	// In production, this would call resolveVersion, getPackageExports, and measureSize
	
	if (type === 'compact') {
		const size = 170; // Example size
		const svg = generateBadgeSvg(`${pkg}@${version}`, formatSize(size), 'server-estimate');
		
		return new Response(svg, { 
			headers: { 
				'Content-Type': 'image/svg+xml',
				'Cache-Control': 'public, max-age=3600'
			} 
		});
	}
	
	if (type === 'standard') {
		const bannerData = {
			pkg,
			version,
			cdn: 'esm.sh',
			bytes: 170,
			exportCount: 3,
			hasEsm: true,
			hasUmd: false,
			isError: false
		};
		
		const svg = generateStandardBanner(bannerData);
		return new Response(svg, { 
			headers: { 
				'Content-Type': 'image/svg+xml',
				'Cache-Control': 'public, max-age=3600'
			} 
		});
	}
	
	if (type === 'full') {
		const exportRows = [
			{ key: 'index', cdn: 'esm.sh', bytes: 170, isError: false },
			{ key: 'middleware', cdn: 'esm.sh', bytes: 120, isError: false },
			{ key: 'react', cdn: 'esm.sh', bytes: 145, isError: false }
		];
		
		const fullBannerData = {
			pkg,
			version,
			exports: exportRows
		};
		
		const svg = generateFullBanner(fullBannerData);
		return new Response(svg, { 
			headers: { 
				'Content-Type': 'image/svg+xml',
				'Cache-Control': 'public, max-age=3600'
			} 
		});
	}
	
	return new Response('Unsupported banner type', { status: 400 });
}
