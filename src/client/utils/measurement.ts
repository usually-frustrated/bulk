// ─── Types ────────────────────────────────────────────────────────────────────

export interface MeasurementEntry {
	pkg: string;
	version: string;
	exportKey: string; // 'index' | 'jsx-runtime' | ...
}

export interface ResourceTimingEntry {
	url: string;
	transferSize: number | null;
	decodedBodySize: number | null;
	startTime: number;
	responseEnd: number;
	initiatorType: string;
	// Annotated after matching against the importmap
	pkg?: string;
	version?: string;
	exportKey?: string;
}

// ─── Own-resource detection ───────────────────────────────────────────────────

/**
 * Returns true if the resource URL belongs to the primary package being
 * measured — not a transitive dependency loaded by the CDN.
 * Mirrors the server-side logic in banner.ts.
 */
function isOwnResource(url: string, pkg: string): boolean {
	const pkgBase = pkg.startsWith('@')
		? pkg.split('/').slice(1).join('/').toLowerCase()
		: pkg.toLowerCase();
	const lurl = url.toLowerCase();
	if (lurl.includes(pkgBase)) return true;
	// CDN-internal chunk files (e.g. chunk-abc123.mjs) are own-package splits
	try {
		const seg = new URL(url).pathname.split('/').pop() ?? '';
		if (/^chunk-[a-z0-9]+\.m?js$/i.test(seg)) return true;
	} catch {}
	return false;
}

// ─── CDN URL construction ─────────────────────────────────────────────────────

/**
 * Build a direct (non-ESM-transform) CDN URL for a file path within a package.
 * Used for UMD / CJS / IIFE / SystemJS measurements via <script> tag.
 */
export function buildScriptUrl(pkg: string, version: string, filePath: string, cdn: string): string {
	const path = filePath.startsWith('/') ? filePath : `/${filePath}`;
	switch (cdn) {
		case 'jsdelivr': return `https://cdn.jsdelivr.net/npm/${pkg}@${version}${path}`;
		case 'unpkg':    return `https://unpkg.com/${pkg}@${version}${path}`;
		// esm.sh doesn't reliably serve raw package files — fall back to jsDelivr
		default:         return `https://cdn.jsdelivr.net/npm/${pkg}@${version}${path}`;
	}
}

export function buildImportmapUrl(pkg: string, version: string, exportKey: string, cdn: string): string {
	const isRoot = exportKey === 'index';
	switch (cdn) {
		case 'jsdelivr':
			return isRoot
				? `https://cdn.jsdelivr.net/npm/${pkg}@${version}/+esm`
				: `https://cdn.jsdelivr.net/npm/${pkg}@${version}/${exportKey}/+esm`;
		case 'esm.sh':
			// ?bundle creates a self-contained file so deps don't load as separate requests
			return isRoot
				? `https://esm.sh/${pkg}@${version}?bundle`
				: `https://esm.sh/${pkg}@${version}/${exportKey}?bundle`;
		case 'unpkg':
			return isRoot
				? `https://unpkg.com/${pkg}@${version}?module`
				: `https://unpkg.com/${pkg}@${version}/${exportKey}?module`;
		default:
			return isRoot
				? `https://cdn.jsdelivr.net/npm/${pkg}@${version}/+esm`
				: `https://cdn.jsdelivr.net/npm/${pkg}@${version}/${exportKey}/+esm`;
	}
}

export function buildBareSpecifier(pkg: string, exportKey: string): string {
	return exportKey === 'index' ? pkg : `${pkg}/${exportKey}`;
}

// ─── Browser info ─────────────────────────────────────────────────────────────

export function getBrowserInfo(): string {
	return navigator.userAgent;
}

export function getConnectionInfo(): string {
	const conn = (navigator as unknown as Record<string, unknown>).connection as
		| { effectiveType?: string; type?: string }
		| undefined;
	return conn?.effectiveType ?? conn?.type ?? 'unknown';
}

// ─── Dependency isolation ─────────────────────────────────────────────────────

/**
 * Well-known sub-path exports for common peer dependencies.
 * When a dep is externalized, its sub-path imports also become bare specifiers
 * and must be stubbed in the importmap alongside the root specifier.
 */
const KNOWN_SUBPATHS: Record<string, string[]> = {
	react:      ['jsx-runtime', 'jsx-dev-runtime'],
	'react-dom': ['client', 'server', 'server.browser'],
};

/** An empty ESM module used to stub dependency imports. */
const DEP_STUB = 'data:application/javascript,export {};';

// ─── Core measurement function ────────────────────────────────────────────────

/**
 * Load a set of packages in a hidden same-origin iframe, then read the
 * browser's Performance Resource Timing entries for every file fetched.
 *
 * For ESM (default): uses an import map + dynamic import().
 * For other formats (UMD, CJS, IIFE, SystemJS): uses a <script> tag with
 * the direct CDN URL to the pre-built bundle file.
 *
 * `externalDeps` — names of the package's direct + peer dependencies.
 * When provided the measurement stubs those deps with empty data: modules so
 * the browser makes zero network requests for them. For esm.sh the CDN URL
 * also receives `&external=dep1,dep2,...` so the bundled file uses bare
 * specifier imports (which the importmap can intercept) instead of absolute
 * CDN URLs (which it cannot).
 *
 * Returns all resources observed during the load, with the primary
 * URL(s) annotated with pkg/version/exportKey.
 */
export async function measurePackages(
	entries: MeasurementEntry[],
	cdn: string,
	format = 'esm',
	formatPath: string | null = null,
	externalDeps: string[] = [],
	timeoutMs = 30_000,
): Promise<ResourceTimingEntry[]> {
	if (!entries.length) return [];

	let srcdoc: string;
	let primaryUrl: string;

	if (format === 'esm' || !formatPath) {
		// ── ESM: import map + dynamic import ─────────────────────────────────
		const imports: Record<string, string> = {};

		// Stub every external dependency with an empty module so the browser
		// makes no network requests for them. Must come before the package
		// entries so the importmap parser sees them first.
		for (const dep of externalDeps) {
			imports[dep] = DEP_STUB;
			// Also stub known sub-path exports (e.g. react/jsx-runtime)
			for (const sub of KNOWN_SUBPATHS[dep] ?? []) {
				imports[`${dep}/${sub}`] = DEP_STUB;
			}
		}

		for (const e of entries) {
			let cdnUrl = buildImportmapUrl(e.pkg, e.version, e.exportKey, cdn);
			// For esm.sh: add ?external=... so the CDN emits bare-specifier
			// imports for deps rather than absolute CDN URLs. Bare specifiers
			// are the only kind the importmap can intercept.
			if (cdn === 'esm.sh' && externalDeps.length > 0) {
				cdnUrl += `&external=${externalDeps.join(',')}`;
			}
			imports[buildBareSpecifier(e.pkg, e.exportKey)] = cdnUrl;
		}

		const importmapJson = JSON.stringify({ imports }, null, 2);
		const importExprs = entries
			.map((e) => `  import(${JSON.stringify(buildBareSpecifier(e.pkg, e.exportKey))}).catch(err => errs.push(err.message))`)
			.join(',\n');
		const moduleScript = `
const errs = [];
Promise.all([
${importExprs}
]).then(() => {
  parent.postMessage({ type: '__bulk_measure_done', errors: errs }, '*');
}).catch(err => {
  parent.postMessage({ type: '__bulk_measure_done', errors: [err.message] }, '*');
});
`;
		srcdoc = [
			'<!DOCTYPE html><html><head>',
			`<script type="importmap">${importmapJson}<\/script>`,
			`<script type="module">${moduleScript}<\/script>`,
			'</head><body></body></html>',
		].join('\n');
		// primaryUrl is the actual CDN URL stored in the importmap (may include
		// ?external=... for esm.sh), not the bare specifier form.
		primaryUrl = imports[buildBareSpecifier(entries[0].pkg, entries[0].exportKey)] ?? '';

	} else {
		// ── Non-ESM: fetch bundle to measure size ─────────────────────────────
		// Classic <script> tags make no-CORS requests, so the browser zeroes out
		// decodedBodySize/transferSize in the Performance API even when the server
		// sets Timing-Allow-Origin: *.  fetch() is CORS by default; jsDelivr
		// returns Access-Control-Allow-Origin: * so size data is always exposed.
		const scriptUrl = buildScriptUrl(entries[0].pkg, entries[0].version, formatPath, cdn);
		srcdoc = [
			'<!DOCTYPE html><html><head>',
			'<script>',
			`fetch(${JSON.stringify(scriptUrl)})`,
			'  .then(function(r) { return r.blob(); })',
			'  .then(function() { parent.postMessage({ type: "__bulk_measure_done", errors: [] }, "*"); })',
			'  .catch(function(err) { parent.postMessage({ type: "__bulk_measure_done", errors: [err.message] }, "*"); });',
			'<\/script>',
			'</head><body></body></html>',
		].join('\n');
		primaryUrl = scriptUrl;
	}

	return new Promise<ResourceTimingEntry[]>((resolve) => {
		const iframe = document.createElement('iframe');
		iframe.style.cssText =
			'position:fixed;width:0;height:0;opacity:0;pointer-events:none;border:none;top:-1px;left:-1px';

		let settled = false;

		const finish = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			window.removeEventListener('message', onMessage);

			let results: ResourceTimingEntry[] = [];
			try {
				const perf = iframe.contentWindow?.performance;
				const raw = (perf?.getEntriesByType('resource') ?? []) as PerformanceResourceTiming[];
				results = raw.map((r) => ({
					url: r.name,
					transferSize: r.transferSize ?? null,
					decodedBodySize: r.decodedBodySize ?? null,
					startTime: r.startTime,
					responseEnd: r.responseEnd,
					initiatorType: r.initiatorType,
				}));
			} catch {
				// cross-origin guard (shouldn't happen for srcdoc iframes on same origin)
			}

			// Annotate the primary resource with entry metadata
			const match = results.find((r) => r.url === primaryUrl);
			if (match) {
				match.pkg = entries[0].pkg;
				match.version = entries[0].version;
				match.exportKey = entries[0].exportKey;
			}
			// Also annotate other own-package resources (chunk splits, sub-files, etc.)
			// so they are included in the waterfall recording.
			for (const r of results) {
				if (!r.pkg && isOwnResource(r.url, entries[0].pkg)) {
					r.pkg      = entries[0].pkg;
					r.version  = entries[0].version;
					r.exportKey = entries[0].exportKey;
				}
			}

			iframe.remove();
			resolve(results);
		};

		const onMessage = (evt: MessageEvent) => {
			if (evt.data?.type === '__bulk_measure_done') finish();
		};

		const timer = window.setTimeout(finish, timeoutMs);
		window.addEventListener('message', onMessage);

		document.body.appendChild(iframe);
		iframe.srcdoc = srcdoc;
	});
}
