import type { Env } from '../types';
import { parseExports } from '../utils/cdn';

// ─── file listing ────────────────────────────────────────────────────────────

/**
 * Fetch flat file list from jsDelivr.
 * Returns paths like "dist/index.mjs" (no leading slash).
 */
async function fetchPackageFiles(pkg: string, version: string): Promise<string[]> {
  const url = `https://data.jsdelivr.com/v1/package/npm/${pkg}@${version}/flat`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data: { files?: { name: string }[] } = await res.json();
  return (data.files ?? []).map((f) => f.name.replace(/^\//, ''));
}

// ─── wildcard helpers ─────────────────────────────────────────────────────────

/**
 * Convert a glob pattern (with a single `*`) to a RegExp that captures the `*` part.
 * Input: "dist/*.mjs"  →  /^dist\/(.+)\.mjs$/
 */
function wildcardToRegex(pattern: string): RegExp {
  // Escape regex specials except *, then replace * with a capture group
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escapes . but NOT *
    .replace(/\*/g, '(.+)');               // now replace the literal *
  return new RegExp(`^${escaped}$`);
}

/**
 * Given a wildcard export entry, expand it against the tarball file list.
 * e.g. key="*"  path="./dist/*.mjs"  →  [{key:"middleware", path:"./dist/middleware.mjs"}, ...]
 */
function expandWildcard(
  keyPattern: string,
  pathPattern: string,
  files: string[],
): { key: string; path: string }[] {
  // Normalize path pattern for matching (strip leading ./)
  const normalized = pathPattern.replace(/^\.\//, '');
  const regex = wildcardToRegex(normalized);

  const results: { key: string; path: string }[] = [];
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

// ─── handler ──────────────────────────────────────────────────────────────────

async function fetchPackageMetadata(pkg: string, version: string): Promise<any> {
  const url = `https://registry.npmjs.org/${pkg}/${version}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch package metadata for ${pkg}@${version}`);
  }
  return response.json();
}

export async function handleDiscoverRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(request.url);
  const pkgName = url.pathname.split('/').pop();

  if (!pkgName) {
    return new Response('Package name required', { status: 400 });
  }

  let pkg = pkgName;
  let version = 'latest';

  if (pkgName.includes('@')) {
    const parts = pkgName.split('@');
    pkg = parts.slice(0, -1).join('@');
    version = parts[parts.length - 1];
  }

  try {
    const pkgJson = await fetchPackageMetadata(pkg, version);
    const resolvedVersion: string = pkgJson.version ?? version;
    const exports = parseExports(pkgJson);

    const staticExports = exports.filter(
      (e) => !e.key.includes('*') && e.key !== 'package.json',
    );
    const wildcardExports = exports.filter((e) => e.key.includes('*'));

    let expanded: { key: string; path: string }[] = [];

    if (wildcardExports.length > 0) {
      const files = await fetchPackageFiles(pkg, resolvedVersion);
      for (const entry of wildcardExports) {
        expanded = expanded.concat(expandWildcard(entry.key, entry.path, files));
      }
    }

    // Deduplicate: static exports take precedence over wildcard-expanded ones
    const existingKeys = new Set(staticExports.map((e) => e.key));
    const uniqueExpanded = expanded.filter((e) => !existingKeys.has(e.key));

    return Response.json({
      package: pkg,
      version: resolvedVersion,
      exports: [...staticExports, ...uniqueExpanded],
      wildcardResolved: expanded.length > 0,
    });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 502;
    return new Response(err instanceof Error ? err.message : 'Discovery failed', { status });
  }
}
