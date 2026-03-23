import { createSignal, Show, onCleanup, createEffect } from 'solid-js';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { LoadingOverlay } from './components/LoadingOverlay';
import { BundleAnalysis } from './components/BundleAnalysis';
import { BundleHistory } from './components/BundleHistory';
import styles from './App.module.css';

export function App() {
	const [pkg, setPkg] = createSignal('react');
	const [inputValue, setInputValue] = createSignal('react');

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
								Enter npm package name
							</label>
							<input
								id="pkg-input"
								type="text"
								class={styles.pkgInput}
								value={inputValue()}
								onInput={(e) => setInputValue(e.currentTarget.value.trim())}
								onKeyDown={(e) => e.key === 'Enter' && setPkg(inputValue().trim())}
								placeholder="react, zustand, lodash, date-fns"
							/>
						</div>
					</div>
				</div>

				<div class={styles.badgePreview}>
					<img src={`/${pkg()}`} alt={`${pkg()} bundle size`} />
				</div>

				<BundleAnalysis pkg={pkg()} onLoading={handleLoading} />
				<BundleHistory pkg={pkg()} onLoading={handleLoading} />
			</div>
			<Footer />
			<Show when={loading()}>
				<LoadingOverlay />
			</Show>
		</main>
	);
}
