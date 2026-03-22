export interface ResourceEntry {
	url: string;
	transferSize: number;
	decodedBodySize: number;
	encodedBodySize: number;
	startTime: number;
	responseEnd: number;
	initiatorType: string;
}

export interface WaterfallRound {
	round: number;
	files: ResourceEntry[];
}

export interface MeasurementResult {
	exportPath: string;
	cdn: string;
	files: number;
	wireBytes: number;
	parseBytes: number;
	rounds: number;
	waterfall: WaterfallRound[];
	resources: ResourceEntry[];
}

export const CDNS = [
	{ id: 'jsdelivr', name: 'jsDelivr', url: (pkg: string, version: string, path: string) => {
		if (path === '.' || path === './') {
			return `https://cdn.jsdelivr.net/npm/${pkg}@${version}/+esm`;
		}
		return `https://cdn.jsdelivr.net/npm/${pkg}@${version}/${path}/+esm`;
	}},
	{ id: 'esmsh', name: 'esm.sh', url: (pkg: string, version: string, path: string) => {
		if (path === '.' || path === './') {
			return `https://esm.sh/${pkg}@${version}`;
		}
		return `https://esm.sh/${pkg}@${version}/${path}`;
	}},
	{ id: 'unpkg', name: 'unpkg', url: (pkg: string, version: string, path: string) => {
		if (path === '.' || path === './') {
			return `https://unpkg.com/${pkg}@${version}?module`;
		}
		return `https://unpkg.com/${pkg}@${version}/${path}?module`;
	}},
] as const;

export type CdnId = typeof CDNS[number]['id'];

function buildSandboxHtml(pkg: string, version: string, exportPath: string, cdn: CdnId): string {
	const cdnConfig = CDNS.find(c => c.id === cdn)!;
	const url = cdnConfig.url(pkg, version, exportPath);
	
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>Measure</title>
</head>
<body>
	<script type="module">
		import * as mod from "${url}";
		window.parent.postMessage({ type: 'LOADED' }, '*');
	</script>
</body>
</html>`;
}

function analyzeWaterfall(entries: ResourceEntry[]): WaterfallRound[] {
	if (entries.length === 0) return [];
	
	const sorted = [...entries].sort((a, b) => a.startTime - b.startTime);
	
	const rounds: WaterfallRound[] = [];
	let currentRound: ResourceEntry[] = [sorted[0]];
	let roundEndTime = sorted[0].responseEnd;
	
	for (let i = 1; i < sorted.length; i++) {
		const entry = sorted[i];
		if (entry.startTime < roundEndTime + 5) {
			currentRound.push(entry);
			if (entry.responseEnd > roundEndTime) {
				roundEndTime = entry.responseEnd;
			}
		} else {
			rounds.push({ round: rounds.length + 1, files: currentRound });
			currentRound = [entry];
			roundEndTime = entry.responseEnd;
		}
	}
	
	if (currentRound.length > 0) {
		rounds.push({ round: rounds.length + 1, files: currentRound });
	}
	
	return rounds;
}

export async function measureExport(
	pkg: string,
	version: string,
	exportPath: string,
	cdn: CdnId,
	timeout = 30000
): Promise<MeasurementResult> {
	return new Promise((resolve, reject) => {
		const iframe = document.createElement('iframe');
		iframe.style.display = 'none';
		
		const sandboxHtml = buildSandboxHtml(pkg, version, exportPath, cdn);
		const blob = new Blob([sandboxHtml], { type: 'text/html' });
		const blobUrl = URL.createObjectURL(blob);
		
		let timeoutId: number;
		
		const cleanup = () => {
			clearTimeout(timeoutId);
			window.removeEventListener('message', handleMessage);
			iframe.remove();
			URL.revokeObjectURL(blobUrl);
		};
		
		const handleMessage = (event: MessageEvent) => {
			if (event.data?.type === 'LOADED') {
				setTimeout(() => {
					const entries = iframe.contentWindow?.performance.getEntriesByType('resource') as PerformanceResourceTiming[];
					
					const resources: ResourceEntry[] = entries.map(e => ({
						url: e.name,
						transferSize: e.transferSize,
						decodedBodySize: e.decodedBodySize,
						encodedBodySize: e.encodedBodySize,
						startTime: e.startTime,
						responseEnd: e.responseEnd,
						initiatorType: e.initiatorType,
					}));
					
					const waterfall = analyzeWaterfall(resources);
					const wireBytes = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
					const parseBytes = resources.reduce((sum, r) => sum + (r.decodedBodySize || 0), 0);
					
					cleanup();
					
					resolve({
						exportPath,
						cdn,
						files: resources.length,
						wireBytes,
						parseBytes,
						rounds: waterfall.length,
						waterfall,
						resources,
					});
				}, 100);
			}
		};
		
		window.addEventListener('message', handleMessage);
		
		timeoutId = window.setTimeout(() => {
			cleanup();
			reject(new Error(`Measurement timeout for ${exportPath} on ${cdn}`));
		}, timeout);
		
		document.body.appendChild(iframe);
		iframe.src = blobUrl;
	});
}

export async function measureAllExports(
	pkg: string,
	version: string,
	exports: string[],
	onProgress?: (current: number, total: number, exportPath: string, cdn: CdnId) => void
): Promise<Record<string, Record<CdnId, MeasurementResult>>> {
	const results: Record<string, Record<CdnId, MeasurementResult>> = {};
	
	let current = 0;
	const total = exports.length * CDNS.length;
	
	for (const exportPath of exports) {
		results[exportPath] = {} as Record<CdnId, MeasurementResult>;
		
		for (const cdn of CDNS) {
			onProgress?.(current, total, exportPath, cdn.id);
			
			try {
				const result = await measureExport(pkg, version, exportPath, cdn.id);
				results[exportPath][cdn.id] = result;
			} catch (error) {
				console.error(`Failed to measure ${exportPath} on ${cdn.id}:`, error);
				results[exportPath][cdn.id] = {
					exportPath,
					cdn: cdn.id,
					files: 0,
					wireBytes: 0,
					parseBytes: 0,
					rounds: 0,
					waterfall: [],
					resources: [],
				};
			}
			
			current++;
		}
	}
	
	return results;
}
