import { createSignal, Show, onCleanup, createEffect } from 'solid-js';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { LoadingOverlay } from './components/LoadingOverlay';
import { MeasurementView } from './components/MeasurementView';
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
								value={inputValue()}
								onInput={(e) => setInputValue(e.currentTarget.value.trim())}
								onKeyDown={(e) => e.key === 'Enter' && setPkg(inputValue().trim())}
								placeholder="e.g. zustand, react, lodash, jsr:@std/testing"
							/>
						</div>
					</div>
				</div>
				<div class={styles.note}>
					<strong>Note:</strong> This tool provides detailed performance analysis using banner-style SVG infographics 
					instead of traditional badges. Results show complete waterfall visualizations and import maps.
				</div>
				<MeasurementView pkg={pkg()} />
			</div>
			<Footer />
			<Show when={loading()}>
				<LoadingOverlay />
			</Show>
		</main>
	);
}
