import type { BundleRequest } from '../types';

/**
 * Parses /_bundle/<pkg>[@<version>][/<exportPath>] into its components.
 *
 * Examples:
 *   /_bundle/react                        → { package: 'react',       version: 'latest', exportPath: 'index' }
 *   /_bundle/react@18.2.0                 → { package: 'react',       version: '18.2.0', exportPath: 'index' }
 *   /_bundle/react@18.2.0/index           → { package: 'react',       version: '18.2.0', exportPath: 'index' }
 *   /_bundle/react@18.2.0/jsx-runtime     → { package: 'react',       version: '18.2.0', exportPath: 'jsx-runtime' }
 *   /_bundle/@scope/pkg@1.0.0/subpath     → { package: '@scope/pkg',  version: '1.0.0',  exportPath: 'subpath' }
 */
export function parseBundlePath(pathname: string): BundleRequest | null {
	const prefix = '/_bundle/';
	if (!pathname.startsWith(prefix)) return null;

	const rest = pathname.slice(prefix.length);
	if (!rest) return null;

	if (rest.startsWith('@')) {
		// Scoped package: @scope/name[@version][/exportPath]
		const match = rest.match(/^(@[^/@][^/]*\/[^@/]+)(?:@([^/]+))?(?:\/(.+))?$/);
		if (!match) return null;
		return {
			package: match[1],
			version: match[2] ?? 'latest',
			exportPath: match[3] ?? 'index',
		};
	}

	// Unscoped package: name[@version][/exportPath]
	const match = rest.match(/^([^@/][^/]*)(?:@([^/]+))?(?:\/(.+))?$/);
	if (!match) return null;
	return {
		package: match[1],
		version: match[2] ?? 'latest',
		exportPath: match[3] ?? 'index',
	};
}
