import type { Env } from '../types';

interface PackageInfo {
	name: string;
	version: string;
	exports: string[];
}

interface NpmPackageJson {
	name: string;
	version: string;
	exports?: Record<string, unknown> | string;
	main?: string;
	module?: string;
}

function parsePackageSpec(input: string): { registry: 'npm' | 'jsr'; pkg: string; version?: string } {
	if (input.startsWith('npm:')) {
		const rest = input.slice(4);
		const atIndex = rest.lastIndexOf('@');
		if (atIndex > 0) {
			return { registry: 'npm', pkg: rest.slice(0, atIndex), version: rest.slice(atIndex + 1) };
		}
		return { registry: 'npm', pkg: rest };
	}
	
	if (input.startsWith('jsr:')) {
		const rest = input.slice(4);
		const atIndex = rest.lastIndexOf('@');
		if (atIndex > 0) {
			return { registry: 'jsr', pkg: rest.slice(0, atIndex), version: rest.slice(atIndex + 1) };
		}
		return { registry: 'jsr', pkg: rest };
	}
	
	return { registry: 'npm', pkg: input };
}

async function resolveNpmVersion(pkg: string, version?: string): Promise<string> {
	if (version && version !== 'latest') {
		return version;
	}
	
	const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
		headers: { Accept: 'application/json' },
	});
	
	if (!res.ok) {
		throw new Error(`Failed to resolve npm version: ${res.status}`);
	}
	
	const data = await res.json() as { version: string };
	return data.version;
}

async function resolveJsrVersion(pkg: string, version?: string): Promise<string> {
	if (version && version !== 'latest') {
		return version;
	}
	
	const res = await fetch(`https://jsr.io/${pkg}/meta.json`, {
		headers: { Accept: 'application/json' },
	});
	
	if (!res.ok) {
		throw new Error(`Failed to resolve jsr version: ${res.status}`);
	}
	
	const data = await res.json() as { versions: Record<string, unknown>; latest: string };
	return data.latest;
}

function parseExports(packageJson: NpmPackageJson): string[] {
	const exports = packageJson.exports;
	const result: string[] = [];
	
	if (!exports) {
		return ['.'];
	}
	
	if (typeof exports === 'string') {
		return ['.'];
	}
	
	for (const key of Object.keys(exports)) {
		if (key === '.' || key === './') {
			if (!result.includes('.')) {
				result.push('.');
			}
		} else if (key.startsWith('./')) {
			const normalized = key.slice(2);
			if (!result.includes(normalized)) {
				result.push(normalized);
			}
		} else if (key === 'import' || key === 'require' || key === 'default' || key === 'types') {
			if (!result.includes('.')) {
				result.push('.');
			}
		} else if (key.includes('*')) {
			result.push('*');
		}
	}
	
	return result.length > 0 ? result : ['.'];
}

async function fetchNpmPackageJson(pkg: string, version: string): Promise<NpmPackageJson> {
	const res = await fetch(`https://unpkg.com/${pkg}@${version}/package.json`);
	if (!res.ok) {
		throw new Error(`Failed to fetch package.json from unpkg: ${res.status}`);
	}
	
	return await res.json() as NpmPackageJson;
}

async function fetchJsrPackageJson(pkg: string, version: string): Promise<NpmPackageJson> {
	const res = await fetch(`https://jsr.io/${pkg}/${version}_package.json`, {
		headers: { Accept: 'application/json' },
	});
	
	if (!res.ok) {
		throw new Error(`Failed to fetch jsr package.json: ${res.status}`);
	}
	
	return await res.json() as NpmPackageJson;
}

export async function handleDiscoverRequest(
	request: Request,
	_env: Env,
	_ctx: ExecutionContext,
): Promise<Response> {
	if (request.method !== 'GET') {
		return new Response('Method not allowed', { status: 405 });
	}
	
	const url = new URL(request.url);
	const pathMatch = url.pathname.match(/^\/_discover\/(.+)$/);
	
	if (!pathMatch) {
		return new Response('Invalid path', { status: 400 });
	}
	
	const input = decodeURIComponent(pathMatch[1]);
	
	try {
		const { registry, pkg, version: requestedVersion } = parsePackageSpec(input);
		
		let packageJson: NpmPackageJson;
		let resolvedVersion: string;
		
		if (registry === 'npm') {
			resolvedVersion = await resolveNpmVersion(pkg, requestedVersion);
			packageJson = await fetchNpmPackageJson(pkg, resolvedVersion);
		} else {
			resolvedVersion = await resolveJsrVersion(pkg, requestedVersion);
			packageJson = await fetchJsrPackageJson(pkg, resolvedVersion);
		}
		
		const exports = parseExports(packageJson);
		
		const result: PackageInfo = {
			name: packageJson.name,
			version: resolvedVersion,
			exports,
		};
		
		return Response.json(result, {
			headers: {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Discovery failed';
		return Response.json({ error: message }, { status: 500 });
	}
}
