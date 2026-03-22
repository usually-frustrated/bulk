import type { Env } from '../types';

interface ExportInfo {
	key: string;
	path: string | null;
}

interface PackageInfo {
	name: string;
	version: string;
	exports: ExportInfo[];
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

function resolveExportPath(exportsObj: Record<string, unknown>, key: string): string | null {
	const entry = exportsObj[key];
	if (!entry) return null;
	
	if (typeof entry === 'string') {
		return entry;
	}
	
	if (typeof entry === 'object') {
		const conditions = ['import', 'module', 'default'];
		for (const cond of conditions) {
			const condEntry = (entry as Record<string, unknown>)[cond];
			if (condEntry && typeof condEntry === 'object' && 'default' in condEntry) {
				const defaultVal = (condEntry as Record<string, unknown>).default;
				if (typeof defaultVal === 'string') {
					return defaultVal;
				}
			}
			if (condEntry && typeof condEntry === 'string') {
				return condEntry;
			}
		}
		const firstKey = Object.keys(entry)[0];
		const firstVal = (entry as Record<string, unknown>)[firstKey];
		if (typeof firstVal === 'string') {
			return firstVal;
		}
		if (typeof firstVal === 'object' && firstVal && 'default' in firstVal) {
			return (firstVal as Record<string, unknown>).default as string;
		}
	}
	
	return null;
}

function parseExports(packageJson: NpmPackageJson): ExportInfo[] {
	const exports = packageJson.exports;
	const result: ExportInfo[] = [];
	const seenKeys = new Set<string>();
	
	if (!exports) {
		return [{ key: '.', path: packageJson.main || packageJson.module || null }];
	}
	
	if (typeof exports === 'string') {
		return [{ key: '.', path: exports }];
	}
	
	const exportsObj = exports as Record<string, unknown>;
	
	for (const key of Object.keys(exportsObj)) {
		if (key === '.' || key === './') {
			if (!seenKeys.has('.')) {
				seenKeys.add('.');
				result.push({ key: '.', path: resolveExportPath(exportsObj, key) });
			}
		} else if (key.startsWith('./')) {
			const normalized = key.slice(2);
			if (!seenKeys.has(normalized)) {
				seenKeys.add(normalized);
				result.push({ key: normalized, path: resolveExportPath(exportsObj, key) });
			}
		} else if (key === 'import' || key === 'require' || key === 'default' || key === 'types') {
			if (!seenKeys.has('.')) {
				seenKeys.add('.');
				result.push({ key: '.', path: resolveExportPath(exportsObj, '.') || resolveExportPath(exportsObj, key) });
			}
		} else if (key.includes('*')) {
			// Wildcard - we'll handle these specially on the client
			// For now, mark them but they'll need file discovery
			result.push({ key: '*', path: null });
		}
	}
	
	return result.length > 0 ? result : [{ key: '.', path: packageJson.main || packageJson.module || null }];
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
		
		// For wildcard exports, try to discover actual files from unpkg
		const wildcardExports = exports.filter(e => e.key === '*');
		if (wildcardExports.length > 0 && registry === 'npm') {
			try {
				const filesRes = await fetch(`https://unpkg.com/browse/${pkg}@${resolvedVersion}/?no-cache`);
				if (filesRes.ok) {
					const html = await filesRes.text();
					const fileMatches = html.matchAll(/href="\/[^"]+?\/([^"/]+)"/g);
					const fileSet = new Set<string>();
					for (const match of fileMatches) {
						const filename = match[1];
						if (filename.endsWith('.js') || filename.endsWith('.mjs')) {
							const baseName = filename.replace(/\.m?js$/, '');
							if (baseName !== 'index' && baseName !== 'package') {
								fileSet.add(baseName);
							}
						}
					}
					
					// Add discovered files as exports
					for (const file of fileSet) {
						if (!exports.some(e => e.key === file)) {
							exports.push({ key: file, path: null });
						}
					}
				}
			} catch {
				// Ignore file discovery errors
			}
		}
		
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
