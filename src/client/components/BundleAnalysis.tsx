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
  const [lastRefreshed, setLastRefreshed] = createSignal<Date | null>(null);

  const formatSize = (bytes: number | null): string => {
    if (bytes === null || bytes === 0) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const fetchAnalysis = async (refresh: boolean = false) => {
    if (!props.pkg.trim()) return;
    
    setLoading(true);
    props.onLoading(true);
    setError(null);
    
    try {
      // Build URL with optional refresh parameter
      const url = `/_bundle/${encodeURIComponent(props.pkg)}?cdn=jsdelivr&exports${refresh ? '&refresh=true' : ''}`;
      console.log('Fetching from:', url);
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch bundle sizes: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('Bundle data:', data);
      
      // The response should have an exports array
      setExports(data.exports || []);
      if (refresh) {
        setLastRefreshed(new Date());
      }
    } catch (err) {
      console.error('Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch bundle analysis');
    } finally {
      setLoading(false);
      props.onLoading(false);
    }
  };

  const handleRefresh = () => {
    fetchAnalysis(true);
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
            <div class={styles.summaryHeader}>
              <h4>Bundle sizes for {props.pkg}</h4>
              <button class={styles.refreshButton} onClick={handleRefresh} disabled={loading()}>
                {loading() ? 'Refreshing...' : 'Refresh Data'}
              </button>
            </div>
            <p>Showing {exports()!.length} exports from jsDelivr CDN</p>
            {lastRefreshed() && (
              <p class={styles.refreshTime}>Last refreshed: {lastRefreshed()!.toLocaleTimeString()}</p>
            )}
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
          <button class={styles.refreshButton} onClick={handleRefresh} disabled={loading()}>
            {loading() ? 'Trying...' : 'Try Refreshing Data'}
          </button>
        </div>
      )}
    </div>
  );
}