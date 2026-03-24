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
 * Load a set of ESM packages in a hidden same-origin iframe, then read
 * the browser's Performance Resource Timing entries for every file fetched.
 *
 * Returns all resources observed during the load, with the primary import
 * URLs annotated with pkg/version/exportKey.
 */
export async function measurePackages(
	entries: MeasurementEntry[],
	cdn: string,
	timeoutMs = 30_000,
): Promise<ResourceTimingEntry[]> {
	if (!entries.length) return [];

	// Build importmap: bare specifier → CDN URL
	const imports: Record<string, string> = {};
	for (const e of entries) {
		imports[buildBareSpecifier(e.pkg, e.exportKey)] = buildImportmapUrl(
			e.pkg,
			e.version,
			e.exportKey,
			cdn,
		);
	}

	const importmapJson = JSON.stringify({ imports }, null, 2);

	// Module script: dynamically import each specifier, then signal the parent
	const importExprs = entries
		.map(
			(e) =>
				`  import(${JSON.stringify(buildBareSpecifier(e.pkg, e.exportKey))}).catch(err => errs.push(err.message))`,
		)
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

	// Full HTML document as srcdoc (same-origin → can read contentWindow.performance)
	const srcdoc = [
		'<!DOCTYPE html><html><head>',
		`<script type="importmap">${importmapJson}<\/script>`,
		`<script type="module">${moduleScript}<\/script>`,
		'</head><body></body></html>',
	].join('\n');

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

			// Annotate primary resources with their entry metadata
			for (const e of entries) {
				const primaryUrl = buildImportmapUrl(e.pkg, e.version, e.exportKey, cdn);
				const match = results.find((r) => r.url === primaryUrl);
				if (match) {
					match.pkg = e.pkg;
					match.version = e.version;
					match.exportKey = e.exportKey;
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
