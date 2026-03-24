import type { ExportEntry } from './cdn';

/**
 * Fetch flat file list from jsDelivr for a given package@version.
 * Returns paths like "dist/index.mjs" (no leading slash).
 */
export async function fetchPackageFiles(pkg: string, version: string): Promise<string[]> {
	const url = `https://data.jsdelivr.com/v1/package/npm/${pkg}@${version}/flat`;
	const res = await fetch(url);
	if (!res.ok) return [];
	const data = (await res.json()) as { files?: { name: string }[] };
	return (data.files ?? []).map((f) => f.name.replace(/^\//, ''));
}

/**
 * Convert a glob pattern (with a single `*`) to a RegExp that captures the `*` part.
 * Input: "dist/*.mjs"  →  /^dist\/(.+)\.mjs$/
 */
function wildcardToRegex(pattern: string): RegExp {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*/g, '(.+)');
	return new RegExp(`^${escaped}$`);
}

/**
 * Expand a single wildcard export entry against the tarball file list.
 * e.g. key="*"  path="./dist/*.mjs"  →  [{key:"middleware", path:"./dist/middleware.mjs"}, ...]
 */
export function expandWildcard(
	keyPattern: string,
	pathPattern: string,
	files: string[],
): ExportEntry[] {
	const normalized = pathPattern.replace(/^\.\//, '');
	const regex = wildcardToRegex(normalized);

	const results: ExportEntry[] = [];
	const seen = new Set<string>();

	for (const file of files) {
		if (!/\.(js|mjs|cjs)$/.test(file)) continue;
		const match = file.match(regex);
		if (!match) continue;

		const captured = match[1];
		const key = keyPattern.replace('*', captured);
		if (seen.has(key)) continue;
		seen.add(key);

		results.push({ key, path: pathPattern.replace('*', captured) });
	}

	return results;
}

/**
 * Given an export list that may contain wildcard entries (key contains `*`),
 * expand them against the package file list and return a flat, deduplicated list.
 * Static (non-wildcard) exports take precedence over wildcard-expanded ones.
 */
export async function expandWildcardExports(
	exports: ExportEntry[],
	pkg: string,
	version: string,
): Promise<ExportEntry[]> {
	const staticExports = exports.filter((e) => !e.key.includes('*') && e.key !== 'package.json');
	const wildcardExports = exports.filter((e) => e.key.includes('*'));

	if (wildcardExports.length === 0) return exports;

	const files = await fetchPackageFiles(pkg, version);

	let expanded: ExportEntry[] = [];
	for (const entry of wildcardExports) {
		expanded = expanded.concat(expandWildcard(entry.key, entry.path, files));
	}

	const existingKeys = new Set(staticExports.map((e) => e.key));
	const uniqueExpanded = expanded.filter((e) => !existingKeys.has(e.key));

	// Re-include package.json if it was in the originals
	const pkgJson = exports.filter((e) => e.key === 'package.json');

	return [...staticExports, ...uniqueExpanded, ...pkgJson];
}
