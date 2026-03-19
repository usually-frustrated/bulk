import type { Plugin } from 'esbuild-wasm';

/**
 * esbuild plugin that resolves and loads modules via HTTP.
 *
 * Import specifiers that begin with https:// are fetched directly.
 * Relative imports within those fetched modules are resolved against
 * the importer's URL, allowing the full transitive dependency graph
 * to be pulled through esm.sh (which handles CJS→ESM conversion,
 * TypeScript, and peer-dep de-duplication server-side).
 */
export const httpPlugin: Plugin = {
	name: 'http',
	setup(build) {
		// Bare https:// specifiers coming from the synthetic entry point
		build.onResolve({ filter: /^https?:\/\// }, (args) => ({
			path: args.path,
			namespace: 'http-url',
		}));

		// Relative specifiers inside a previously fetched http-url module
		build.onResolve({ filter: /.*/, namespace: 'http-url' }, (args) => ({
			path: new URL(args.path, args.importer).toString(),
			namespace: 'http-url',
		}));

		build.onLoad({ filter: /.*/, namespace: 'http-url' }, async (args) => {
			const response = await fetch(args.path, {
				headers: { Accept: 'application/javascript, text/javascript, */*' },
				redirect: 'follow',
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch ${args.path}: ${response.status} ${response.statusText}`);
			}

			const contents = await response.text();
			const contentType = response.headers.get('content-type') ?? '';

			let loader: 'js' | 'ts' | 'jsx' | 'tsx' = 'js';
			if (contentType.includes('typescript') || args.path.endsWith('.ts')) {
				loader = 'ts';
			} else if (args.path.endsWith('.tsx')) {
				loader = 'tsx';
			} else if (args.path.endsWith('.jsx')) {
				loader = 'jsx';
			}

			return { contents, loader };
		});
	},
};
