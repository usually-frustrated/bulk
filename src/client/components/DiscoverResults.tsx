import { createSignal, onMount, onCleanup } from 'solid-js';

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

export function DiscoverResults(props: { pkg: string }) {
  const [discoverData, setDiscoverData] = createSignal<DiscoverResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);

  const fetchDiscoverData = async () => {
    if (!props.pkg.trim()) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/_/discover/${encodeURIComponent(props.pkg)}`);
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

  // Re-fetch when package changes
  const handlePkgChange = () => {
    fetchDiscoverData();
  };

  // Cleanup effect
  onCleanup(() => {
    // Cleanup if needed
  });

  return (
    <div class="discover-results">
      {loading() && <div>Loading package exports...</div>}
      {error() && <div class="error">Error: {error()}</div>}
      {discoverData() && (
        <div>
          <h3>Exports for {discoverData()?.package}@{discoverData()?.version}</h3>
          <p>{discoverData()?.exports.length} exports found</p>
          <table>
            <thead>
              <tr>
                <th>Export Path</th>
                <th>File Path</th>
              </tr>
            </thead>
            <tbody>
              {discoverData()?.exports.map((exp) => (
                <tr>
                  <td>{exp.key}</td>
                  <td>{exp.path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}