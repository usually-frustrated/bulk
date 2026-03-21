import { createSignal, Show } from 'solid-js';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { ExportsTable } from './components/ExportsTable';
import { BundleHistory } from './components/BundleHistory';
import { LoadingOverlay } from './components/LoadingOverlay';
import styles from './App.module.css';

export const CDN_OPTIONS = [
	{ id: 'jsdelivr', name: 'jsDelivr', bundleCdn: 'jsdelivr' },
	{ id: 'unpkg', name: 'unpkg', bundleCdn: 'unpkg' },
	{ id: 'esmsh', name: 'esm.sh', bundleCdn: 'esm.sh' },
] as const;

export type CdnId = (typeof CDN_OPTIONS)[number]['id'];

export function App() {
	const [pkg, setPkg] = createSignal('zustand');
	const [cdn, setCdn] = createSignal<CdnId>('jsdelivr');

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
								value={pkg()}
								onInput={(e) => setPkg(e.currentTarget.value.trim())}
								placeholder="e.g. zustand, react, lodash"
							/>
						</div>
						<div class={styles.cdnInputGroup}>
							<label for="cdn-select" class={styles.inputLabel}>
								CDN
							</label>
							<select
								id="cdn-select"
								class={styles.cdnSelect}
								value={cdn()}
								onChange={(e) => setCdn(e.currentTarget.value as CdnId)}
							>
								{CDN_OPTIONS.map((o) => (
									<option value={o.id}>{o.name}</option>
								))}
							</select>
						</div>
					</div>
				</div>
				<ExportsTable pkg={pkg()} cdn={cdn()} onLoading={handleLoading} />
				<BundleHistory pkg={pkg()} cdn={cdn()} onLoading={handleLoading} />
			</div>
			<Footer />
			<Show when={loading()}>
				<LoadingOverlay />
			</Show>
		</main>
	);
}
