import type { Env } from '../types';
import { parseExports } from '../utils/cdn';

// ─── npm tarball extraction ──────────────────────────────────────────────────

/**
 * Fetch package metadata from npm registry
 */
async function fetchPackageMetadata(pkg: string, version: string): Promise<any> {
  const url = `https://registry.npmjs.org/${pkg}/${version}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch package metadata for ${pkg}@${version}`);
  }
  return response.json();
}

/**
 * Extract file list from npm tarball
 */
async function extractTarballFiles(pkg: string, version: string): Promise<string[]> {
  // Using the npm registry meta endpoint to get tarball URL
  const metadata = await fetchPackageMetadata(pkg, version);
  const tarballUrl = metadata.dist.tarball;
  
  // Download tarball and extract files (simplified approach)
  // In a real implementation, we'd need to parse the tarball properly
  // For now, we'll use the unpkg meta endpoint which provides file listings
  const metaUrl = `https://unpkg.com/${pkg}@${version}/?meta`;
  const metaResponse = await fetch(metaUrl);
  
  if (!metaResponse.ok) {
    // Fall back to package.json exports if meta isn't available
    return [];
  }
  
  try {
    const meta: { files?: Record<string, any> } = await metaResponse.json();
    return Object.keys(meta.files || {});
  } catch {
    return [];
  }
}

/**
 * Parse package exports including wildcard resolution
 */
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

  // Parse package name to extract version if provided
  let pkg = pkgName;
  let version = 'latest';
  
  if (pkgName.includes('@')) {
    const parts = pkgName.split('@');
    pkg = parts.slice(0, -1).join('@');
    version = parts[parts.length - 1];
  }

  try {
    // For JSR packages, we might need different handling
    if (pkg.startsWith('jsr:')) {
      // JSR packages are handled differently, but for MVP we'll treat them as regular packages
      // This is a simplified approach - real JSR handling would be more involved
    }
    
    // Get package metadata from npm registry
    // /<pkg>/latest (and any dist-tag) returns the package.json directly.
    // /<pkg>/<semver> also returns it directly. There is no wrapper with a
    // `versions` map — that only exists on the full registry document (no version).
    const pkgJson = await fetchPackageMetadata(pkg, version);
    const resolvedVersion: string = pkgJson.version ?? version;
    const exports = parseExports(pkgJson);
    
    // Handle wildcard exports by extracting files from tarball
    const wildcardExports = exports.filter(e => e.key.endsWith('/*'));
    const resolvedWildcardExports: string[] = [];
    
    if (wildcardExports.length > 0) {
      const files = await extractTarballFiles(pkg, resolvedVersion);
      // For wildcard exports, we generate all possible paths based on file extensions
      for (const exportEntry of wildcardExports) {
        const baseKey = exportEntry.key.replace('/*', '');
        for (const file of files) {
          if (file.startsWith(baseKey) && file !== baseKey) {
            // Remove base path from file name to get the export key
            const key = file.replace(baseKey + '/', '').replace(/\.[^.]+$/, ''); // Remove extension
            if (key && !resolvedWildcardExports.includes(key)) {
              resolvedWildcardExports.push(key);
            }
          }
        }
      }
    }
    
    // Combine regular exports with resolved wildcards
    const allExports = [...exports.filter(e => !e.key.endsWith('/*')), ...resolvedWildcardExports.map(k => ({
      key: k,
      path: `./${k}.js`
    }))];

    return Response.json({
      package: pkg,
      version: resolvedVersion,
      exports: allExports,
      wildcardResolved: resolvedWildcardExports.length > 0
    });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 502;
    return new Response(err instanceof Error ? err.message : 'Discovery failed', { status });
  }
}