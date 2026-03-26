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

// ─── Core measurement function ────────────────────────────────────────────────

/**
 * Load a set of packages in a hidden same-origin iframe, then read the
 * browser's Performance Resource Timing entries for every file fetched.
 *
 * For ESM (default): uses an import map + dynamic import().
 * For other formats (UMD, CJS, IIFE, SystemJS): uses a <script> tag with
 * the direct CDN URL to the pre-built bundle file.
 *
 * Returns all resources observed during the load, with the primary
 * URL(s) annotated with pkg/version/exportKey.
 */
export async function measurePackages(
	entries: MeasurementEntry[],
	cdn: string,
	format = 'esm',
	formatPath: string | null = null,
	timeoutMs = 30_000,
): Promise<ResourceTimingEntry[]> {
	if (!entries.length) return [];

	let srcdoc: string;
	let primaryUrl: string;

	if (format === 'esm' || !formatPath) {
		// ── ESM: import map + dynamic import ─────────────────────────────────
		const imports: Record<string, string> = {};
		for (const e of entries) {
			imports[buildBareSpecifier(e.pkg, e.exportKey)] = buildImportmapUrl(
				e.pkg, e.version, e.exportKey, cdn,
			);
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
		primaryUrl = buildImportmapUrl(entries[0].pkg, entries[0].version, entries[0].exportKey, cdn);

	} else {
		// ── Non-ESM: script tag with direct bundle URL ────────────────────────
		const scriptUrl = buildScriptUrl(entries[0].pkg, entries[0].version, formatPath, cdn);
		srcdoc = [
			'<!DOCTYPE html><html><head>',
			'<script>',
			'var s = document.createElement("script");',
			`s.src = ${JSON.stringify(scriptUrl)};`,
			's.onload  = function() { parent.postMessage({ type: "__bulk_measure_done", errors: [] }, "*"); };',
			's.onerror = function() { parent.postMessage({ type: "__bulk_measure_done", errors: ["load error"] }, "*"); };',
			'document.head.appendChild(s);',
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
