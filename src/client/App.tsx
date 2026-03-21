import { createSignal, Show } from 'solid-js';
import { Header } from './components/Header';
import { UsageInfo } from './components/UsageInfo';
import { ExportsTable } from './components/ExportsTable';
import { BundleHistory } from './components/BundleHistory';
import { LoadingOverlay } from './components/LoadingOverlay';
import styles from './App.module.css';

export function App() {
	const [pkg, setPkg] = createSignal('zustand');
	const [loading, setLoading] = createSignal(false);

	return (
		<main>
			<div class="hero-section">
				<Header />
				<div class={styles.pkgInputWrap}>
					<label for="pkg-input" class={styles.pkgLabel}>
						Package name
					</label>
					<input
						id="pkg-input"
						type="text"
						class={styles.pkgInput}
						value={pkg()}
						onInput={(e) => setPkg(e.currentTarget.value.trim())}
						placeholder="e.g. zustand, react, lodash"
					/>
				</div>
				<ExportsTable pkg={pkg()} onLoading={setLoading} />
				<BundleHistory pkg={pkg()} onLoading={setLoading} />
				<UsageInfo />
			</div>
			<Show when={loading()}>
				<LoadingOverlay />
			</Show>
		</main>
	);
}
