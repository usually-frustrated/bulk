import { createSignal, Show, onCleanup, createEffect } from 'solid-js';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { LoadingOverlay } from './components/LoadingOverlay';
import { BadgeGenerator } from './components/BadgeGenerator';
import { BundleAnalysis } from './components/BundleAnalysis';
import { BundleHistory } from './components/BundleHistory';
import styles from './App.module.css';

export function App() {
	const [pkg, setPkg] = createSignal('zustand');
	const [inputValue, setInputValue] = createSignal('zustand');

	// Debounce input: only update pkg 500ms after user stops typing
	let debounceTimer: number | undefined;
	createEffect(() => {
		const value = inputValue();
		if (debounceTimer) {
			window.clearTimeout(debounceTimer);
		}
		debounceTimer = window.setTimeout(() => {
			setPkg(value.trim());
		}, 500);
	});
	onCleanup(() => {
		if (debounceTimer) {
			window.clearTimeout(debounceTimer);
		}
	});

	// Counter-based loading: overlay stays up until ALL active fetches finish
	const [loadingCount, setLoadingCount] = createSignal(0);
	const loading = () => loadingCount() > 0;
	const handleLoading = (v: boolean) => setLoadingCount((c) => Math.max(0, c + (v ? 1 : -1)));

	return (
		<main>
			<div class="hero-section">
				<Header />
				
				<div class={styles.valueProp}>
					<h2>What runtime impact does library X have?</h2>
					<p>Understand the actual CDN bundle size, compare across providers, and track changes over time.</p>
				</div>

				<div class={styles.badgeSection}>
					<h3>Generate Live SVG Badges</h3>
					<BadgeGenerator />
				</div>

				<div class={styles.analysisSection}>
					<h3>Bundle Size Analysis</h3>
					<div class={styles.pkgInputWrap}>
						<div class={styles.inputRow}>
							<div class={styles.inputGroup}>
								<label for="pkg-input" class={styles.inputLabel}>
									Analyze any npm package
								</label>
								<input
									id="pkg-input"
									type="text"
									class={styles.pkgInput}
									value={inputValue()}
									onInput={(e) => setInputValue(e.currentTarget.value.trim())}
									onKeyDown={(e) => e.key === 'Enter' && setPkg(inputValue().trim())}
									placeholder="e.g. react, zustand, lodash, date-fns"
								/>
							</div>
						</div>
					</div>
					<BundleAnalysis pkg={pkg()} onLoading={handleLoading} />
				</div>

				<div class={styles.historySection}>
					<h3>Version History & Trends</h3>
					<BundleHistory pkg={pkg()} onLoading={handleLoading} />
				</div>

				<div class={styles.features}>
					<h3>Key Features</h3>
					<div class={styles.featureGrid}>
						<div class={styles.feature}>
							<h4>CDN Comparison</h4>
							<p>Compare bundle sizes across jsDelivr, unpkg, and esm.sh</p>
						</div>
						<div class={styles.feature}>
							<h4>Export Analysis</h4>
							<p>See individual export sizes and their impact</p>
						</div>
						<div class={styles.feature}>
							<h4>Historical Tracking</h4>
							<p>Track bundle size changes across versions</p>
						</div>
						<div class={styles.feature}>
							<h4>Live Badges</h4>
							<p>Embed SVG badges that update automatically</p>
						</div>
					</div>
				</div>
			</div>
			<Footer />
			<Show when={loading()}>
				<LoadingOverlay />
			</Show>
		</main>
	);
}
