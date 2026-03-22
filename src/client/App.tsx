import { createSignal, Show, createEffect } from 'solid-js';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { SummaryTable } from './components/SummaryTable';
import { Waterfall } from './components/Waterfall';
import { LoadingOverlay } from './components/LoadingOverlay';
import { measureAllExports, type CdnId, type MeasurementResult } from './utils/measure';
import styles from './App.module.css';

interface ExportInfo {
	key: string;
	path: string | null;
}

interface PackageInfo {
	name: string;
	version: string;
	exports: ExportInfo[];
}

export function App() {
	const [pkgInput, setPkgInput] = createSignal('zustand');
	const [pkg, setPkg] = createSignal<PackageInfo | null>(null);
	const [measurements, setMeasurements] = createSignal<Record<string, Record<CdnId, MeasurementResult>>>({});
	const [loading, setLoading] = createSignal(false);
	const [loadingProgress, setLoadingProgress] = createSignal({ current: 0, total: 0 });
	const [selectedExport, setSelectedExport] = createSignal<string | null>(null);
	const [error, setError] = createSignal<string | null>(null);

	const handleDiscover = async () => {
		if (!pkgInput().trim()) return;
		
		setLoading(true);
		setError(null);
		setPkg(null);
		setMeasurements({});
		setSelectedExport(null);
		
		try {
			// Step 1: Discover package exports
			const discoverRes = await fetch(`/_discover/${encodeURIComponent(pkgInput())}`);
			if (!discoverRes.ok) {
				const err = await discoverRes.json();
				throw new Error(err.error || 'Discovery failed');
			}
			
			const packageInfo: PackageInfo = await discoverRes.json();
			setPkg(packageInfo);
			
			// Step 2: Measure all exports across all CDNs
			const exportKeys = packageInfo.exports.map(e => e.key);
			const results = await measureAllExports(
				packageInfo.name,
				packageInfo.version,
				exportKeys,
				(current, total, exportPath, cdn) => {
					setLoadingProgress({ current, total });
				}
			);
			
			setMeasurements(results);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to analyze package');
		} finally {
			setLoading(false);
		}
	};
	
	// Auto-discover on initial load
	createEffect(() => {
		handleDiscover();
	});

	const selectedMeasurement = () => {
		const exp = selectedExport();
		if (!exp) return null;
		
		const expMeasurements = measurements()[exp];
		if (!expMeasurements) return null;
		
		// For now, show the best CDN's measurement
		const bestCdn = Object.entries(expMeasurements)
			.filter(([, m]) => m.wireBytes > 0)
			.sort(([, a], [, b]) => a.wireBytes - b.wireBytes)[0];
		
		return bestCdn?.[1] || null;
	};

	return (
		<main>
			<div class="hero-section">
				<Header />
				<div class={styles.pkgInputWrap}>
					<div class={styles.inputRow}>
						<div class={styles.inputGroup}>
							<label for="pkg-input" class={styles.inputLabel}>
								Package name
							</label>
							<input
								id="pkg-input"
								type="text"
								class={styles.pkgInput}
								value={pkgInput()}
								onInput={(e) => setPkgInput(e.currentTarget.value.trim())}
								onKeyDown={(e) => e.key === 'Enter' && handleDiscover()}
								placeholder="e.g. zustand, react, npm:lodash, jsr:@std/testing"
							/>
						</div>
						<button 
							class={styles.discoverBtn}
							onClick={handleDiscover}
							disabled={loading()}
						>
							Discover
						</button>
					</div>
				</div>
				
				<Show when={error()}>
					{(err) => (
						<div class={styles.error}>
							{err()}
						</div>
					)}
				</Show>
				
				<Show when={pkg()}>
					{(p) => (
						<>
							<SummaryTable
								pkg={p().name}
								version={p().version}
								exports={p().exports}
								measurements={measurements()}
								onSelectExport={setSelectedExport}
								selectedExport={selectedExport()}
							/>
							
							<Show when={selectedExport()}>
								<Waterfall measurement={selectedMeasurement()} />
							</Show>
						</>
					)}
				</Show>
			</div>
			<Footer />
			<Show when={loading()}>
				<LoadingOverlay progress={loadingProgress()} />
			</Show>
		</main>
	);
}
