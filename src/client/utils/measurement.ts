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
  // Add allow-top-navigation if needed for cross-origin navigation
  iframe.sandbox.add('allow-top-navigation');
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
    // Check if iframe is still valid
    if (!iframe.contentWindow || !iframe.contentDocument) {
      return [];
    }
    
    // Access iframe's performance data
    if (iframe.contentWindow.performance) {
      const perf = iframe.contentWindow.performance;
      const entries = perf.getEntriesByType('resource');
      
      // Filter out non-http resources and normalize data
      return entries
        .filter(entry => entry.name.startsWith('http'))
        .map(entry => ({
          url: entry.name,
          transferSize: entry.transferSize || 0,
          decodedBodySize: entry.decodedBodySize || 0,
          startTime: entry.startTime,
          responseEnd: entry.responseEnd,
          initiatorType: entry.initiatorType
        }));
    }
    
    return [];
  } catch (err) {
    console.error('Failed to extract performance data:', err);
    return [];
  }
}

/**
 * Load a module in iframe and measure its performance
 */
export async function loadAndMeasureInIframe(
  url: string, 
  iframe: HTMLIFrameElement
): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      // Set up iframe content with module loading
      const content = `
        <!DOCTYPE html>
        <html>
        <head><title>Measurement Frame</title></head>
        <body>
          <script type="module">
            // Load the module
            import('${url}')
              .then(() => {
                // Signal completion
                window.postMessage({ type: 'loaded', url: '${url}' }, '*');
              })
              .catch(err => {
                window.postMessage({ type: 'error', url: '${url}', error: err.message }, '*');
              });
          </script>
        </body>
        </html>
      `;
      
      // Write content to iframe
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(content);
        doc.close();
      }
      
      // Listen for completion messages
      const handleMessage = (event: MessageEvent) => {
        if (event.data.type === 'loaded' || event.data.type === 'error') {
          window.removeEventListener('message', handleMessage);
          if (event.data.type === 'error') {
            reject(new Error(event.data.error));
          } else {
            // Extract performance data after a short delay to ensure measurements are collected
            setTimeout(() => {
              extractPerformanceData(iframe).then(resolve).catch(reject);
            }, 100);
          }
        }
      };
      
      window.addEventListener('message', handleMessage);
      
      // Timeout protection
      setTimeout(() => {
        window.removeEventListener('message', handleMessage);
        reject(new Error('Timeout waiting for module load'));
      }, 10000);
      
    } catch (err) {
      reject(err);
    }
  });
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
  try {
    // Create iframe for measurement
    const iframe = createMeasurementIframe();
    document.body.appendChild(iframe);
    
    // Construct the CDN URL
    const isRoot = exportKey === 'index';
    const subpath = isRoot ? '' : `/${exportKey}`;
    const suffix = isRoot && cdn === 'jsdelivr' ? '/+esm' : '';
    const url = `https://${cdn}.net/npm/${pkg}@${version}${subpath}${suffix}`;
    
    // Load and measure in iframe
    const resources = await loadAndMeasureInIframe(url, iframe);
    
    // Clean up iframe
    document.body.removeChild(iframe);
    
    // Process and return results
    if (resources.length > 0) {
      // Group resources by round trips (based on timing gaps)
      const sortedResources = [...resources].sort((a, b) => a.startTime - b.startTime);
      
      // Calculate statistics
      const totalWireSize = resources.reduce((sum, res) => sum + (res.transferSize || 0), 0);
      const totalParseSize = resources.reduce((sum, res) => sum + (res.decodedBodySize || 0), 0);
      const fileCount = resources.length;
      
      // Group into rounds based on timing gaps
      let roundTrips = 1;
      let currentRoundStart = sortedResources[0]?.startTime || 0;
      
      for (let i = 1; i < sortedResources.length; i++) {
        const gap = sortedResources[i].startTime - currentRoundStart;
        if (gap > 50) { // 50ms threshold for new round
          roundTrips++;
          currentRoundStart = sortedResources[i].startTime;
        }
      }
      
      return {
        exportKey,
        cdn,
        wireSize: totalWireSize,
        parseSize: totalParseSize,
        fileCount,
        roundTrips,
        resources
      };
    }
    
    return {
      exportKey,
      cdn,
      wireSize: 0,
      parseSize: 0,
      fileCount: 0,
      roundTrips: 0,
      resources: []
    };
  } catch (err) {
    console.error(`Failed to measure ${pkg}/${exportKey} on ${cdn}:`, err);
    return {
      exportKey,
      cdn,
      wireSize: 0,
      parseSize: 0,
      fileCount: 0,
      roundTrips: 0,
      resources: [],
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

/**
 * Measure all exports across all CDNs
 */
export async function measureAllExports(
  pkg: string,
  version: string,
  exports: { key: string; path: string }[],
  cdns: string[]
): Promise<Record<string, any>> {
  const results: Record<string, any> = {};
  
  // Measure each export on each CDN
  for (const cdn of cdns) {
    results[cdn] = {};
    for (const exp of exports) {
      try {
        const result = await measureExport(pkg, version, exp.key, cdn);
        results[cdn][exp.key] = result;
      } catch (err) {
        console.error(`Measurement failed for ${pkg}/${exp.key} on ${cdn}:`, err);
        results[cdn][exp.key] = {
          exportKey: exp.key,
          cdn,
          wireSize: 0,
          parseSize: 0,
          fileCount: 0,
          roundTrips: 0,
          resources: [],
          error: err instanceof Error ? err.message : 'Unknown error'
        };
      }
    }
  }
  
  return results;
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
    // Check if iframe is still valid
    if (!iframe.contentWindow || !iframe.contentDocument) {
      return [];
    }
    
    // Access iframe's performance data
    if (iframe.contentWindow.performance) {
      const perf = iframe.contentWindow.performance;
      const entries = perf.getEntriesByType('resource');
      
      // Filter out non-http resources and normalize data
      return entries
        .filter(entry => entry.name.startsWith('http'))
        .map(entry => ({
          url: entry.name,
          transferSize: entry.transferSize || 0,
          decodedBodySize: entry.decodedBodySize || 0,
          startTime: entry.startTime,
          responseEnd: entry.responseEnd,
          initiatorType: entry.initiatorType
        }));
    }
    
    return [];
  } catch (err) {
    console.error('Failed to extract performance data:', err);
    return [];
  }
}

/**
 * Load a module in iframe and measure its performance
 */
export async function loadAndMeasureInIframe(
  url: string, 
  iframe: HTMLIFrameElement
): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      // Set up iframe content with module loading
      const content = `
        <!DOCTYPE html>
        <html>
        <head><title>Measurement Frame</title></head>
        <body>
          <script type="module">
            // Load the module
            import('${url}')
              .then(() => {
                // Signal completion
                window.postMessage({ type: 'loaded', url: '${url}' }, '*');
              })
              .catch(err => {
                window.postMessage({ type: 'error', url: '${url}', error: err.message }, '*');
              });
          </script>
        </body>
        </html>
      `;
      
      // Write content to iframe
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(content);
        doc.close();
      }
      
      // Listen for completion messages
      const handleMessage = (event: MessageEvent) => {
        if (event.data.type === 'loaded' || event.data.type === 'error') {
          window.removeEventListener('message', handleMessage);
          if (event.data.type === 'error') {
            reject(new Error(event.data.error));
          } else {
            // Extract performance data after a short delay to ensure measurements are collected
            setTimeout(() => {
              extractPerformanceData(iframe).then(resolve).catch(reject);
            }, 100);
          }
        }
      };
      
      window.addEventListener('message', handleMessage);
      
      // Timeout protection
      setTimeout(() => {
        window.removeEventListener('message', handleMessage);
        reject(new Error('Timeout waiting for module load'));
      }, 10000);
      
    } catch (err) {
      reject(err);
    }
  });
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
  try {
    // Create iframe for measurement
    const iframe = createMeasurementIframe();
    document.body.appendChild(iframe);
    
    // Construct the CDN URL
    const isRoot = exportKey === 'index';
    const subpath = isRoot ? '' : `/${exportKey}`;
    const suffix = isRoot && cdn === 'jsdelivr' ? '/+esm' : '';
    const url = `https://${cdn}.net/npm/${pkg}@${version}${subpath}${suffix}`;
    
    // Load and measure in iframe
    const resources = await loadAndMeasureInIframe(url, iframe);
    
    // Clean up iframe
    document.body.removeChild(iframe);
    
    // Process and return results
    if (resources.length > 0) {
      // Group resources by round trips (based on timing gaps)
      const sortedResources = [...resources].sort((a, b) => a.startTime - b.startTime);
      
      // Calculate statistics
      const totalWireSize = resources.reduce((sum, res) => sum + (res.transferSize || 0), 0);
      const totalParseSize = resources.reduce((sum, res) => sum + (res.decodedBodySize || 0), 0);
      const fileCount = resources.length;
      
      // Group into rounds based on timing gaps
      let roundTrips = 1;
      let currentRoundStart = sortedResources[0]?.startTime || 0;
      
      for (let i = 1; i < sortedResources.length; i++) {
        const gap = sortedResources[i].startTime - currentRoundStart;
        if (gap > 50) { // 50ms threshold for new round
          roundTrips++;
          currentRoundStart = sortedResources[i].startTime;
        }
      }
      
      return {
        exportKey,
        cdn,
        wireSize: totalWireSize,
        parseSize: totalParseSize,
        fileCount,
        roundTrips,
        resources
      };
    }
    
    return {
      exportKey,
      cdn,
      wireSize: 0,
      parseSize: 0,
      fileCount: 0,
      roundTrips: 0,
      resources: []
    };
  } catch (err) {
    console.error(`Failed to measure ${pkg}/${exportKey} on ${cdn}:`, err);
    return {
      exportKey,
      cdn,
      wireSize: 0,
      parseSize: 0,
      fileCount: 0,
      roundTrips: 0,
      resources: [],
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

/**
 * Measure all exports across all CDNs
 */
export async function measureAllExports(
  pkg: string,
  version: string,
  exports: { key: string; path: string }[],
  cdns: string[]
): Promise<Record<string, any>> {
  const results: Record<string, any> = {};
  
  // Measure each export on each CDN
  for (const cdn of cdns) {
    results[cdn] = {};
    for (const exp of exports) {
      try {
        const result = await measureExport(pkg, version, exp.key, cdn);
        results[cdn][exp.key] = result;
      } catch (err) {
        console.error(`Measurement failed for ${pkg}/${exp.key} on ${cdn}:`, err);
        results[cdn][exp.key] = {
          exportKey: exp.key,
          cdn,
          wireSize: 0,
          parseSize: 0,
          fileCount: 0,
          roundTrips: 0,
          resources: [],
          error: err instanceof Error ? err.message : 'Unknown error'
        };
      }
    }
  }
  
  return results;
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
    // Access iframe's performance data
    if (iframe.contentWindow && iframe.contentWindow.performance) {
      const perf = iframe.contentWindow.performance;
      const entries = perf.getEntriesByType('resource');
      
      return entries.map(entry => ({
        url: entry.name,
        transferSize: entry.transferSize,
        decodedBodySize: entry.decodedBodySize,
        startTime: entry.startTime,
        responseEnd: entry.responseEnd,
        initiatorType: entry.initiatorType
      }));
    }
    
    return [];
  } catch (err) {
    console.error('Failed to extract performance data:', err);
    return [];
  }
}

/**
 * Load a module in iframe and measure its performance
 */
export async function loadAndMeasureInIframe(
  url: string, 
  iframe: HTMLIFrameElement
): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      // Set up iframe content with module loading
      const content = `
        <!DOCTYPE html>
        <html>
        <head><title>Measurement Frame</title></head>
        <body>
          <script type="module">
            // Load the module
            import('${url}')
              .then(() => {
                // Signal completion
                window.postMessage({ type: 'loaded', url: '${url}' }, '*');
              })
              .catch(err => {
                window.postMessage({ type: 'error', url: '${url}', error: err.message }, '*');
              });
          </script>
        </body>
        </html>
      `;
      
      // Write content to iframe
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(content);
        doc.close();
      }
      
      // Listen for completion messages
      const handleMessage = (event: MessageEvent) => {
        if (event.data.type === 'loaded' || event.data.type === 'error') {
          window.removeEventListener('message', handleMessage);
          if (event.data.type === 'error') {
            reject(new Error(event.data.error));
          } else {
            // Extract performance data after a short delay to ensure measurements are collected
            setTimeout(() => {
              extractPerformanceData(iframe).then(resolve).catch(reject);
            }, 100);
          }
        }
      };
      
      window.addEventListener('message', handleMessage);
      
      // Timeout protection
      setTimeout(() => {
        window.removeEventListener('message', handleMessage);
        reject(new Error('Timeout waiting for module load'));
      }, 10000);
      
    } catch (err) {
      reject(err);
    }
  });
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
  try {
    // Create iframe for measurement
    const iframe = createMeasurementIframe();
    document.body.appendChild(iframe);
    
    // Construct the CDN URL
    const isRoot = exportKey === 'index';
    const subpath = isRoot ? '' : `/${exportKey}`;
    const suffix = isRoot && cdn === 'jsdelivr' ? '/+esm' : '';
    const url = `https://${cdn}.net/npm/${pkg}@${version}${subpath}${suffix}`;
    
    // Load and measure in iframe
    const resources = await loadAndMeasureInIframe(url, iframe);
    
    // Clean up iframe
    document.body.removeChild(iframe);
    
    // Process and return results
    if (resources.length > 0) {
      // Group resources by round trips (based on timing gaps)
      const sortedResources = [...resources].sort((a, b) => a.startTime - b.startTime);
      
      // Calculate statistics
      const totalWireSize = resources.reduce((sum, res) => sum + (res.transferSize || 0), 0);
      const totalParseSize = resources.reduce((sum, res) => sum + (res.decodedBodySize || 0), 0);
      const fileCount = resources.length;
      
      // Group into rounds based on timing gaps
      let roundTrips = 1;
      let currentRoundStart = sortedResources[0]?.startTime || 0;
      
      for (let i = 1; i < sortedResources.length; i++) {
        const gap = sortedResources[i].startTime - currentRoundStart;
        if (gap > 50) { // 50ms threshold for new round
          roundTrips++;
          currentRoundStart = sortedResources[i].startTime;
        }
      }
      
      return {
        exportKey,
        cdn,
        wireSize: totalWireSize,
        parseSize: totalParseSize,
        fileCount,
        roundTrips,
        resources
      };
    }
    
    return {
      exportKey,
      cdn,
      wireSize: 0,
      parseSize: 0,
      fileCount: 0,
      roundTrips: 0,
      resources: []
    };
  } catch (err) {
    console.error(`Failed to measure ${pkg}/${exportKey} on ${cdn}:`, err);
    return {
      exportKey,
      cdn,
      wireSize: 0,
      parseSize: 0,
      fileCount: 0,
      roundTrips: 0,
      resources: [],
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

/**
 * Measure all exports across all CDNs
 */
export async function measureAllExports(
  pkg: string,
  version: string,
  exports: { key: string; path: string }[],
  cdns: string[]
): Promise<Record<string, any>> {
  const results: Record<string, any> = {};
  
  // Measure each export on each CDN
  for (const cdn of cdns) {
    results[cdn] = {};
    for (const exp of exports) {
      try {
        const result = await measureExport(pkg, version, exp.key, cdn);
        results[cdn][exp.key] = result;
      } catch (err) {
        console.error(`Measurement failed for ${pkg}/${exp.key} on ${cdn}:`, err);
        results[cdn][exp.key] = {
          exportKey: exp.key,
          cdn,
          wireSize: 0,
          parseSize: 0,
          fileCount: 0,
          roundTrips: 0,
          resources: [],
          error: err instanceof Error ? err.message : 'Unknown error'
        };
      }
    }
  }
  
  return results;
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
    // Access iframe's performance data
    if (iframe.contentWindow && iframe.contentWindow.performance) {
      const perf = iframe.contentWindow.performance;
      const entries = perf.getEntriesByType('resource');
      
      return entries.map(entry => ({
        url: entry.name,
        transferSize: entry.transferSize,
        decodedBodySize: entry.decodedBodySize,
        startTime: entry.startTime,
        responseEnd: entry.responseEnd,
        initiatorType: entry.initiatorType
      }));
    }
    
    return [];
  } catch (err) {
    console.error('Failed to extract performance data:', err);
    return [];
  }
}

/**
 * Load a module in iframe and measure its performance
 */
export async function loadAndMeasureInIframe(
  url: string, 
  iframe: HTMLIFrameElement
): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      // Set up iframe content with module loading
      const content = `
        <!DOCTYPE html>
        <html>
        <head><title>Measurement Frame</title></head>
        <body>
          <script type="module">
            // Load the module
            import('${url}')
              .then(() => {
                // Signal completion
                window.postMessage({ type: 'loaded', url: '${url}' }, '*');
              })
              .catch(err => {
                window.postMessage({ type: 'error', url: '${url}', error: err.message }, '*');
              });
          </script>
        </body>
        </html>
      `;
      
      // Write content to iframe
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(content);
        doc.close();
      }
      
      // Listen for completion messages
      const handleMessage = (event: MessageEvent) => {
        if (event.data.type === 'loaded' || event.data.type === 'error') {
          window.removeEventListener('message', handleMessage);
          if (event.data.type === 'error') {
            reject(new Error(event.data.error));
          } else {
            // Extract performance data after a short delay to ensure measurements are collected
            setTimeout(() => {
              extractPerformanceData(iframe).then(resolve).catch(reject);
            }, 100);
          }
        }
      };
      
      window.addEventListener('message', handleMessage);
      
      // Timeout protection
      setTimeout(() => {
        window.removeEventListener('message', handleMessage);
        reject(new Error('Timeout waiting for module load'));
      }, 10000);
      
    } catch (err) {
      reject(err);
    }
  });
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
  try {
    // Create iframe for measurement
    const iframe = createMeasurementIframe();
    document.body.appendChild(iframe);
    
    // Construct the CDN URL
    const isRoot = exportKey === 'index';
    const subpath = isRoot ? '' : `/${exportKey}`;
    const suffix = isRoot && cdn === 'jsdelivr' ? '/+esm' : '';
    const url = `https://${cdn}.net/npm/${pkg}@${version}${subpath}${suffix}`;
    
    // Load and measure in iframe
    const resources = await loadAndMeasureInIframe(url, iframe);
    
    // Clean up iframe
    document.body.removeChild(iframe);
    
    // Process and return results
    if (resources.length > 0) {
      // Group resources by round trips (based on timing gaps)
      const sortedResources = [...resources].sort((a, b) => a.startTime - b.startTime);
      
      // Calculate statistics
      const totalWireSize = resources.reduce((sum, res) => sum + (res.transferSize || 0), 0);
      const totalParseSize = resources.reduce((sum, res) => sum + (res.decodedBodySize || 0), 0);
      const fileCount = resources.length;
      
      // Group into rounds based on timing gaps
      let roundTrips = 1;
      let currentRoundStart = sortedResources[0]?.startTime || 0;
      
      for (let i = 1; i < sortedResources.length; i++) {
        const gap = sortedResources[i].startTime - currentRoundStart;
        if (gap > 50) { // 50ms threshold for new round
          roundTrips++;
          currentRoundStart = sortedResources[i].startTime;
        }
      }
      
      return {
        exportKey,
        cdn,
        wireSize: totalWireSize,
        parseSize: totalParseSize,
        fileCount,
        roundTrips,
        resources
      };
    }
    
    return {
      exportKey,
      cdn,
      wireSize: 0,
      parseSize: 0,
      fileCount: 0,
      roundTrips: 0,
      resources: []
    };
  } catch (err) {
    console.error(`Failed to measure ${pkg}/${exportKey} on ${cdn}:`, err);
    return {
      exportKey,
      cdn,
      wireSize: 0,
      parseSize: 0,
      fileCount: 0,
      roundTrips: 0,
      resources: [],
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

/**
 * Measure all exports across all CDNs
 */
export async function measureAllExports(
  pkg: string,
  version: string,
  exports: { key: string; path: string }[],
  cdns: string[]
): Promise<Record<string, any>> {
  const results: Record<string, any> = {};
  
  // Measure each export on each CDN
  for (const cdn of cdns) {
    results[cdn] = {};
    for (const exp of exports) {
      try {
        const result = await measureExport(pkg, version, exp.key, cdn);
        results[cdn][exp.key] = result;
      } catch (err) {
        console.error(`Measurement failed for ${pkg}/${exp.key} on ${cdn}:`, err);
        results[cdn][exp.key] = {
          exportKey: exp.key,
          cdn,
          wireSize: 0,
          parseSize: 0,
          fileCount: 0,
          roundTrips: 0,
          resources: [],
          error: err instanceof Error ? err.message : 'Unknown error'
        };
      }
    }
  }
  
  return results;
}