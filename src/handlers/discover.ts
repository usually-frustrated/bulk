import type { Env } from '../types';
import { parseExports } from '../utils/cdn';
import { fetchPackageFiles, expandWildcard } from '../utils/wildcard';
import { detectFormats } from '../utils/formats';

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
  const pkgName = decodeURIComponent(url.pathname.slice('/_discover/'.length));

  if (!pkgName) {
    return new Response('Package name required', { status: 400 });
  }

  let pkg = pkgName;
  let version = 'latest';

  if (pkgName.startsWith('@')) {
    // Scoped package: @scope/name or @scope/name@version
    const atVersion = pkgName.indexOf('@', 1);
    if (atVersion !== -1) {
      pkg = pkgName.slice(0, atVersion);
      version = pkgName.slice(atVersion + 1);
    }
  } else if (pkgName.includes('@')) {
    // Unscoped package: name@version
    const atVersion = pkgName.indexOf('@');
    pkg = pkgName.slice(0, atVersion);
    version = pkgName.slice(atVersion + 1);
  }

  try {
    const pkgJson = await fetchPackageMetadata(pkg, version);
    const resolvedVersion: string = pkgJson.version ?? version;

    // Always fetch the flat file list — used for both wildcard export expansion
    // and bundle format detection (UMD/CJS/SystemJS/IIFE).
    const files = await fetchPackageFiles(pkg, resolvedVersion);
    const formats = detectFormats(files);

    // If no exports field, show all JS files from the tarball
    if (!pkgJson.exports) {
      const jsFiles = files.filter((f) => /\.(js|mjs|cjs)$/.test(f));

      if (jsFiles.length > 0) {
        // Deduplicate by stem, prefer .mjs > .js > .cjs
        const extRank: Record<string, number> = { mjs: 0, js: 1, cjs: 2 };
        const byKey = new Map<string, string>();
        for (const f of jsFiles) {
          const ext = f.match(/\.(mjs|js|cjs)$/)?.[1] ?? 'js';
          const stem = f.replace(/\.(mjs|js|cjs)$/, '');
          const existing = byKey.get(stem);
          const existingExt = existing?.match(/\.(mjs|js|cjs)$/)?.[1] ?? 'js';
          if (!existing || (extRank[ext] ?? 3) < (extRank[existingExt] ?? 3)) {
            byKey.set(stem, f);
          }
        }
        const fileExports = Array.from(byKey.entries()).map(([stem, file]) => ({
          key: stem === 'index' ? 'index' : stem,
          path: `./${file}`,
        }));
        return Response.json({
          package: pkg,
          version: resolvedVersion,
          exports: fileExports,
          wildcardResolved: false,
          formats,
        });
      }
    }

    const exports = parseExports(pkgJson);

    const staticExports = exports.filter(
      (e) => !e.key.includes('*') && e.key !== 'package.json',
    );
    const wildcardExports = exports.filter((e) => e.key.includes('*'));

    let expanded: { key: string; path: string }[] = [];

    if (wildcardExports.length > 0) {
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
      formats,
    });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 502;
    return new Response(err instanceof Error ? err.message : 'Discovery failed', { status });
  }
}
