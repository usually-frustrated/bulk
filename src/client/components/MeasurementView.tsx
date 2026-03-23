import { createSignal, onMount } from 'solid-js';
import styles from '../MeasurementView.module.css';

interface ExportEntry {
  key: string;
  path: string;
}

interface DiscoverResult {
  package: string;
  version: string;
  exports: ExportEntry[];
  wildcardResolved: boolean;
}

export function MeasurementView(props: { pkg: string }) {
  const [discoverData, setDiscoverData] = createSignal<DiscoverResult | null>(null);
  const [measurementResults, setMeasurementResults] = createSignal<Record<string, any> | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [measuring, setMeasuring] = createSignal(false);

  const fetchDiscoverData = async () => {
    if (!props.pkg.trim()) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/_discover/${encodeURIComponent(props.pkg)}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
      }
      
      const data: DiscoverResult = await response.json();
      setDiscoverData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch package data');
    } finally {
      setLoading(false);
    }
  };

  // Fetch data when package changes
  onMount(() => {
    fetchDiscoverData();
  });

  // Measure exports across CDNs (mock implementation)
  const measureExports = async () => {
    if (!discoverData()) return;
    
    setMeasuring(true);
    setError(null);
    
    try {
      // Mock implementation - in a real version, this would call the actual measurement function
      const results: Record<string, any> = {};
      const cdns = ['jsdelivr', 'unpkg', 'esmsh'];
      const exports = discoverData()!.exports;
      
      for (const cdn of cdns) {
        results[cdn] = {};
        for (const exp of exports) {
          // Generate fake measurement data for demonstration
          const fileSize = Math.floor(Math.random() * 100000) + 1000; // Random size between 1KB and 100KB
          const fileCount = Math.floor(Math.random() * 5) + 1; // Random count between 1-5
          
          results[cdn][exp.key] = {
            wireSize: fileSize,
            fileCount,
            bestCdn: cdn,
            roundTrips: Math.ceil(fileCount / 3),
            resources: [
              {
                url: `https://cdn.jsdelivr.net/npm/${discoverData()!.package}@${discoverData()!.version}/${exp.key}.js`,
                transferSize: fileSize,
                decodedBodySize: fileSize * 1.2,
                startTime: 0,
                responseEnd: 50,
                initiatorType: 'script'
              }
            ]
          };
        }
      }
      
      setMeasurementResults(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to measure exports');
    } finally {
      setMeasuring(false);
    }
  };

  return (
    <div class={styles.measurementView}>
      {loading() && <div>Loading package exports...</div>}
      {error() && <div class={styles.error}>Error: {error()}</div>}
      
      {discoverData() && (
        <div>
          <h3>Exports for {discoverData()?.package}@{discoverData()?.version}</h3>
          <p>{discoverData()?.exports.length} exports found</p>
          
          <div class={styles.actions}>
            <button onClick={measureExports} disabled={measuring()}>
              {measuring() ? 'Measuring...' : 'Measure All Exports'}
            </button>
          </div>
          
          {measurementResults() && (
            <div class={styles.results}>
              <h4>Measurement Results</h4>
              <div class={styles.summaryTable}>
                <table>
                  <thead>
                    <tr>
                      <th>Export</th>
                      <th>jsDelivr</th>
                      <th>unpkg</th>
                      <th>esm.sh</th>
                      <th>Best CDN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discoverData()?.exports.map((exp) => {
                      const results = measurementResults()!;
                      const jsdelivrResult = results.jsdelivr?.[exp.key];
                      const unpkgResult = results.unpkg?.[exp.key];
                      const esmshResult = results.esmsh?.[exp.key];
                      
                      return (
                        <tr>
                          <td>{exp.key}</td>
                          <td>{jsdelivrResult ? `${(jsdelivrResult.wireSize/1024).toFixed(1)} kB (${jsdelivrResult.fileCount} files)` : '-'}</td>
                          <td>{unpkgResult ? `${(unpkgResult.wireSize/1024).toFixed(1)} kB (${unpkgResult.fileCount} files)` : '-'}</td>
                          <td>{esmshResult ? `${(esmshResult.wireSize/1024).toFixed(1)} kB (${esmshResult.fileCount} files)` : '-'}</td>
                          <td>{jsdelivrResult ? 'jsDelivr' : unpkgResult ? 'unpkg' : esmshResult ? 'esm.sh' : '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              
              <div class={styles.waterfallChart}>
                <h4>Waterfall Visualization</h4>
                <p>Click on an export to see detailed waterfall breakdown</p>
              </div>
            </div>
          )}
          
          <div class={styles.importmapOutput}>
            <h4>Import Map</h4>
            <pre>{`{
  "${discoverData()?.package}": "https://cdn.jsdelivr.net/npm/${discoverData()?.package}@${discoverData()?.version}/+esm"
}`}</pre>
          </div>
        </div>
      )}
    </div>
  );
}