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
      // Fetch from jsdelivr by default
      const response = await fetch(`/_bundle/${encodeURIComponent(props.pkg)}?cdn=jsdelivr`);
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      setExports(data.exports || []);
    } catch (err) {
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
      {loading() && <div class={styles.loading}>Loading bundle analysis...</div>}
      {error() && <div class={styles.error}>Error: {error()}</div>}
      
      {exports() && exports()!.length > 0 && (
        <div class={styles.results}>
          <div class={styles.summary}>
            <h4>Exports for {props.pkg}</h4>
            <p>Showing {exports()!.length} exports with bundle sizes</p>
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
      
      {exports() && exports()!.length === 0 && !loading() && (
        <div class={styles.empty}>
          <p>No bundle data available for {props.pkg}</p>
          <p>Try a different package or check the package name.</p>
        </div>
      )}
    </div>
  );
}