import { createSignal, createEffect, For } from 'solid-js';
import styles from './BundleAnalysis.module.css';

interface BundleSize {
  bytes_raw: number;
  bytes_transfer: number;
  fetched_at: string;
}

interface ExportAnalysis {
  key: string;
  jsdelivr: BundleSize | null;
  unpkg: BundleSize | null;
  esmsh: BundleSize | null;
}

interface BundleAnalysisProps {
  pkg: string;
  onLoading: (loading: boolean) => void;
}

export function BundleAnalysis(props: BundleAnalysisProps) {
  const [analysis, setAnalysis] = createSignal<ExportAnalysis[] | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const formatSize = (bytes: number | null): string => {
    if (bytes === null) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getBestCDN = (exportData: ExportAnalysis): string => {
    const sizes = {
      jsdelivr: exportData.jsdelivr?.bytes_transfer || Infinity,
      unpkg: exportData.unpkg?.bytes_transfer || Infinity,
      esmsh: exportData.esmsh?.bytes_transfer || Infinity,
    };
    
    const minSize = Math.min(sizes.jsdelivr, sizes.unpkg, sizes.esmsh);
    if (minSize === Infinity) return '-';
    
    if (minSize === sizes.jsdelivr) return 'jsDelivr';
    if (minSize === sizes.unpkg) return 'unpkg';
    return 'esm.sh';
  };

  const fetchAnalysis = async () => {
    if (!props.pkg.trim()) return;
    
    setLoading(true);
    props.onLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/_bundle/${encodeURIComponent(props.pkg)}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Transform the data into our analysis format
      const exports = data.exports || [];
      const analysisData: ExportAnalysis[] = exports.map((exp: any) => ({
        key: exp.key,
        jsdelivr: exp.jsdelivr || null,
        unpkg: exp.unpkg || null,
        esmsh: exp.esmsh || null,
      }));
      
      setAnalysis(analysisData);
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
      
      {analysis() && analysis()!.length > 0 && (
        <div class={styles.results}>
          <div class={styles.summary}>
            <h4>Bundle Size Comparison</h4>
            <p>Showing {analysis()!.length} exports for {props.pkg}</p>
          </div>
          
          <div class={styles.tableContainer}>
            <table class={styles.analysisTable}>
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
                <For each={analysis()}>
                  {(exportData) => (
                    <tr>
                      <td class={styles.exportKey}>{exportData.key}</td>
                      <td class={styles.sizeCell}>
                        {exportData.jsdelivr ? (
                          <div>
                            <div class={styles.sizeValue}>{formatSize(exportData.jsdelivr.bytes_transfer)}</div>
                            <div class={styles.sizeDetail}>transfer</div>
                          </div>
                        ) : '-'}
                      </td>
                      <td class={styles.sizeCell}>
                        {exportData.unpkg ? (
                          <div>
                            <div class={styles.sizeValue}>{formatSize(exportData.unpkg.bytes_transfer)}</div>
                            <div class={styles.sizeDetail}>transfer</div>
                          </div>
                        ) : '-'}
                      </td>
                      <td class={styles.sizeCell}>
                        {exportData.esmsh ? (
                          <div>
                            <div class={styles.sizeValue}>{formatSize(exportData.esmsh.bytes_transfer)}</div>
                            <div class={styles.sizeDetail}>transfer</div>
                          </div>
                        ) : '-'}
                      </td>
                      <td class={styles.bestCdn}>
                        <span class={styles.bestCdnBadge}>{getBestCDN(exportData)}</span>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          
          <div class={styles.note}>
            <strong>Note:</strong> Transfer size is the compressed size served by CDN. 
            This reflects actual network impact, not just file size.
          </div>
        </div>
      )}
      
      {analysis() && analysis()!.length === 0 && (
        <div class={styles.empty}>
          <p>No bundle data available for {props.pkg}</p>
          <p>Try a different package or check the package name.</p>
        </div>
      )}
    </div>
  );
}