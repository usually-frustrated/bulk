// ─── Browser-based measurement helpers ───────────────────────────────────────

/**
 * Create a sandboxed iframe for performance measurement
 * This would be used to load modules and collect PerformanceResourceTiming data
 */
export function createMeasurementIframe(): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.sandbox.add('allow-scripts');
  iframe.sandbox.add('allow-same-origin');
  return iframe;
}

/**
 * Generate importmap for loading multiple packages in iframe
 */
export function generateImportMap(packages: string[], version: string, cdn: string): string {
  const imports: Record<string, string> = {};
  
  packages.forEach(pkg => {
    // Simplified importmap generation - in reality this would be more complex
    // For now, we'll generate a basic one with the root package
    imports[pkg] = `https://${cdn}.net/npm/${pkg}@${version}/+esm`;
  });
  
  return JSON.stringify({ imports }, null, 2);
}

/**
 * Extract performance data from iframe
 */
export async function extractPerformanceData(iframe: HTMLIFrameElement): Promise<any[]> {
  try {
    // This would access the iframe's performance data
    // In a real implementation:
    // const perf = iframe.contentWindow.performance;
    // const entries = perf.getEntriesByType('resource');
    // return entries.map(entry => ({
    //   url: entry.name,
    //   transferSize: entry.transferSize,
    //   decodedBodySize: entry.decodedBodySize,
    //   startTime: entry.startTime,
    //   responseEnd: entry.responseEnd,
    //   initiatorType: entry.initiatorType
    // }));
    
    // For demo purposes, return dummy data
    return [
      {
        url: 'https://cdn.jsdelivr.net/npm/react@18.3.1/+esm',
        transferSize: 132539,
        decodedBodySize: 150000,
        startTime: 0,
        responseEnd: 50,
        initiatorType: 'script'
      }
    ];
  } catch (err) {
    console.error('Failed to extract performance data:', err);
    return [];
  }
}

/**
 * Measure a single export path across CDNs
 */
export async function measureExport(
  pkg: string,
  version: string,
  exportKey: string,
  cdn: string
): Promise<any> {
  // This would implement the actual browser measurement
  // For now, return simulated data
  
  // In a real implementation:
  // 1. Create sandboxed iframe
  // 2. Inject importmap or direct script tags
  // 3. Load the module
  // 4. Collect performance data
  // 5. Return structured results
  
  return {
    exportKey,
    cdn,
    wireSize: Math.floor(Math.random() * 100000) + 5000,
    parseSize: Math.floor(Math.random() * 150000) + 10000,
    fileCount: Math.floor(Math.random() * 5) + 1,
    roundTrips: Math.ceil(Math.random() * 3),
    resources: []
  };
}