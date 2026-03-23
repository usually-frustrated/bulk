import { createSignal, createEffect, For } from 'solid-js';
import styles from './BundleAnalysis.module.css';

interface ExportResult {
  key: string;
  bytes_raw: number | null;
  bytes_transfer: number | null;
}

interface BundleAnalysisProps {
  pkg: string;
  onLoading: (loading: boolean) => void;
}

export function BundleAnalysis(props: BundleAnalysisProps) {
  const [exports, setExports] = createSignal<ExportResult[] | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const formatSize = (bytes: number | null): string => {
    if (bytes === null || bytes === 0) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const fetchAnalysis = async () => {
    if (!props.pkg.trim()) return;
    
    setLoading(true);
    props.onLoading(true);
    setError(null);
    
    try {
      // First try to discover package exports
      const discoverResponse = await fetch(`/_discover/${encodeURIComponent(props.pkg)}`);
      if (!discoverResponse.ok) {
        throw new Error(`Failed to discover package: ${discoverResponse.status} ${discoverResponse.statusText}`);
      }
      
      const discoverData = await discoverResponse.json();
      console.log('Discover data:', discoverData);
      
      // Then fetch bundle sizes for each export
      const bundleResponse = await fetch(`/_bundle/${encodeURIComponent(props.pkg)}?cdn=jsdelivr&exports`);
      if (!bundleResponse.ok) {
        throw new Error(`Failed to fetch bundle sizes: ${bundleResponse.status} ${bundleResponse.statusText}`);
      }
      
      const bundleData = await bundleResponse.json();
      console.log('Bundle data:', bundleData);
      
      // The response should have an exports array
      setExports(bundleData.exports || []);
    } catch (err) {
      console.error('Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch bundle analysis');
    } finally {
      setLoading(false);
      props.onLoading(false);
    }
  };

  createEffect(() => {
    if (props.pkg.trim()) {
      fetchAnalysis();
    }
  });

  return (
    <div class={styles.bundleAnalysis}>
      {loading() && <div class={styles.loading}>Loading bundle analysis for {props.pkg}...</div>}
      {error() && <div class={styles.error}>Error: {error()}</div>}
      
      {exports() && exports()!.length > 0 && (
        <div class={styles.results}>
          <div class={styles.summary}>
            <h4>Bundle sizes for {props.pkg}</h4>
            <p>Showing {exports()!.length} exports from jsDelivr CDN</p>
          </div>
          
          <div class={styles.tableContainer}>
            <table class={styles.analysisTable}>
              <thead>
                <tr>
                  <th>Export</th>
                  <th>Transfer Size</th>
                  <th>Raw Size</th>
                </tr>
              </thead>
              <tbody>
                <For each={exports()}>
                  {(exportItem) => (
                    <tr>
                      <td class={styles.exportKey}>{exportItem.key}</td>
                      <td class={styles.sizeCell}>
                        <div class={styles.sizeValue}>{formatSize(exportItem.bytes_transfer)}</div>
                        <div class={styles.sizeDetail}>compressed</div>
                      </td>
                      <td class={styles.sizeCell}>
                        <div class={styles.sizeValue}>{formatSize(exportItem.bytes_raw)}</div>
                        <div class={styles.sizeDetail}>uncompressed</div>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {exports() && exports()!.length === 0 && !loading() && !error() && (
        <div class={styles.empty}>
          <p>No bundle data available for {props.pkg}</p>
          <p>The package might not have any exports or the CDN might not have it cached yet.</p>
        </div>
      )}
    </div>
  );
}