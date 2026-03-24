import { createSignal, createEffect, on, Show, For, onCleanup, onMount, batch } from 'solid-js';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { LoadingOverlay } from './components/LoadingOverlay';
import { BundleHistory } from './components/BundleHistory';
import { Waterfall } from './components/Waterfall';
import { OutputTabs } from './components/OutputTabs';
import { BadgeGenerator } from './components/BadgeGenerator';
import {
	measurePackages,
	getBrowserInfo,
	getConnectionInfo,
	type MeasurementEntry,
	type ResourceTimingEntry,
} from './utils/measurement';
import styles from './App.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

type CDN = 'jsdelivr' | 'esm.sh' | 'unpkg';

interface DiscoverResult {
	package: string;
	version: string;
	exports: { key: string; path: string }[];
	wildcardResolved: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getQueryParam(key: string): string | null {
	return new URLSearchParams(window.location.search).get(key);
}

/**
 * Parse "react/jsx-runtime" or "@reduxjs/toolkit/query/react" into
 * {pkg, exportKey}. Scoped packages (@scope/name) are handled correctly.
 */
function parseInput(input: string): { pkg: string; exportKey: string } {
	const s = input.trim();
	if (s.startsWith('@')) {
		const parts = s.split('/');
		if (parts.length <= 2) return { pkg: s, exportKey: 'index' };
		return { pkg: parts.slice(0, 2).join('/'), exportKey: parts.slice(2).join('/') };
	}
	const slash = s.indexOf('/');
	if (slash === -1) return { pkg: s, exportKey: 'index' };
	return { pkg: s.slice(0, slash), exportKey: s.slice(slash + 1) };
}

/** Sync the ?export= query param immediately (called on chip click). */
function syncExportParam(exp: string) {
	const params = new URLSearchParams(window.location.search);
	if (exp && exp !== 'index') {
		params.set('export', exp);
	} else {
		params.delete('export');
	}
	const qs = params.toString();
	history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

// ─── App ──────────────────────────────────────────────────────────────────────

export function App() {
	// ── Inputs ─────────────────────────────────────────────────────────────────

	const initialPkg = getQueryParam('pkg') ?? 'react';
	const initialExport = getQueryParam('export');

	// pkgInput = live text-field value (updates on every keystroke, drives discover)
	// pkg      = committed value (only updates when the user clicks Measure / presses Enter)
	const [pkgInput, setPkgInput] = createSignal(initialPkg);
	const [pkg, setPkg] = createSignal(initialPkg);
	const [cdn, setCdn] = createSignal<CDN>('jsdelivr');

	// Derived: package name only (no export suffix)
	const firstPkgInput = () => parseInput(pkgInput()).pkg; // for discover / chip display
	const firstPkg = () => parseInput(pkg()).pkg;           // for data fetching / URL sync

	// ── Commit helpers ──────────────────────────────────────────────────────────

	/** Commit the current draft input as the active package. */
	function commitPkg() {
		setPkg(pkgInput());
	}

	// ── URL sync (pkg) ──────────────────────────────────────────────────────────
	// Syncs the committed pkg to ?pkg= (debounced to avoid thrashing history).

	let urlSyncTimer: number | undefined;
	createEffect(() => {
		const p = firstPkg();
		if (urlSyncTimer) window.clearTimeout(urlSyncTimer);
		urlSyncTimer = window.setTimeout(() => {
			const params = new URLSearchParams(window.location.search);
			if (p && p !== 'react') {
				params.set('pkg', p);
			} else {
				params.delete('pkg');
			}
			params.delete('export');
			const qs = params.toString();
			history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
		}, 400);
	});
	onCleanup(() => {
		if (urlSyncTimer) window.clearTimeout(urlSyncTimer);
	});

	// ── Discovery (suggestions) ────────────────────────────────────────────────
	// Driven by the draft input so chips update as the user types.

	const [discoverData, setDiscoverData] = createSignal<DiscoverResult | null>(null);
	const [discoverPkg, setDiscoverPkg] = createSignal('');

	let discoverTimer: number | undefined;
	createEffect(() => {
		const p = firstPkgInput();
		if (discoverTimer) window.clearTimeout(discoverTimer);
		if (!p.trim()) return;
		discoverTimer = window.setTimeout(async () => {
			try {
				const res = await fetch(`/_discover/${encodeURIComponent(p)}`);
				if (!res.ok) return;
				const data = (await res.json()) as DiscoverResult;
				setDiscoverData(data);
				setDiscoverPkg(p);
			} catch {}
		}, 600);
	});
	onCleanup(() => {
		if (discoverTimer) window.clearTimeout(discoverTimer);
	});

	// ── Measurement state ───────────────────────────────────────────────────────

	const [measuring, setMeasuring] = createSignal(false);
	const [measureError, setMeasureError] = createSignal<string | null>(null);
	const [resources, setResources] = createSignal<ResourceTimingEntry[] | null>(null);
	const [measuredEntries, setMeasuredEntries] = createSignal<MeasurementEntry[] | null>(null);
	const [measuredCdn, setMeasuredCdn] = createSignal<CDN>('jsdelivr');

	// ── Measure handler ─────────────────────────────────────────────────────────
	// Commits the draft input, then runs browser measurement.

	const handleMeasure = async () => {
		// Commit the draft input before measuring.
		commitPkg();
		const pkgName = parseInput(pkgInput()).pkg;
		if (!pkgName) return;

		batch(() => {
			setMeasuring(true);
			setMeasureError(null);
			setResources(null);
			setMeasuredEntries(null);
		});

		try {
			// 1. Resolve version via /_discover
			const res0 = await fetch(`/_discover/${encodeURIComponent(pkgName)}`);
			if (!res0.ok) throw new Error(`Could not resolve ${pkgName}: ${res0.statusText}`);
			const dr = (await res0.json()) as DiscoverResult;

			// 2. Single measurement entry: package + selected export
			const exportKey = selectedExport() || 'index';
			const entries: MeasurementEntry[] = [{ pkg: pkgName, version: dr.version, exportKey }];

			// 3. Run browser measurement in iframe
			const selectedCdn = cdn();
			const rawResources = await measurePackages(entries, selectedCdn);

			// 4. Report to /_record (fire-and-forget)
			const annotated = rawResources.filter(
				(r) => r.pkg && typeof r.transferSize === 'number' && r.transferSize > 0,
			);
			if (annotated.length) {
				fetch('/_record', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						cdn: selectedCdn,
						browser: getBrowserInfo(),
						connection: getConnectionInfo(),
						resources: annotated,
					}),
				}).catch(() => {});
			}

			batch(() => {
				setResources(rawResources);
				setMeasuredEntries(entries);
				setMeasuredCdn(selectedCdn);
			});
		} catch (err) {
			setMeasureError(err instanceof Error ? err.message : 'Measurement failed');
		} finally {
			setMeasuring(false);
		}
	};

	// ── Export selection ────────────────────────────────────────────────────────
	// Driven by chip clicks; also resets when the committed package changes.

	const [selectedExport, setSelectedExport] = createSignal(initialExport ?? '');

	// Reset export (and clear stale measurement results) when pkg is committed.
	createEffect(on(firstPkg, () => {
		setSelectedExport('');
		setResources(null);
		setMeasuredEntries(null);
	}, { defer: true }));

	// Clear stale measurement results when a different export is selected.
	createEffect(on(selectedExport, () => {
		setResources(null);
		setMeasuredEntries(null);
	}, { defer: true }));

	// Auto-measure on initial load.
	onMount(() => { void handleMeasure(); });

	// ── Loading overlay (for BundleHistory only) ────────────────────────────────

	const [loadingCount, setLoadingCount] = createSignal(0);
	const loading = () => loadingCount() > 0;
	const handleLoading = (v: boolean) => setLoadingCount((c) => Math.max(0, c + (v ? 1 : -1)));

	// ── Render ──────────────────────────────────────────────────────────────────

	return (
		<main>
			<div class="hero-section">
				<Header />

				{/* ── Inputs ─────────────────────────────────────────────── */}
				<div class={styles.pkgInputWrap}>
					<div class={styles.inputRow}>
						<div class={styles.inputGroup}>
							<label class={styles.inputLabel}>package</label>
							<input
								type="text"
								class={styles.pkgInput}
								value={pkgInput()}
								onInput={(e) => setPkgInput(e.currentTarget.value.trim())}
								placeholder="react@18.2.0, zustand, @reduxjs/toolkit"
								spellcheck={false}
							/>
						</div>

						<button
							class={styles.runBtn}
							onClick={handleMeasure}
							disabled={measuring()}
							aria-label="measure"
						>&#x25B6;</button>

						<div class={styles.cdnGroup}>
							<label class={styles.inputLabel}>cdn</label>
							<select
								class={styles.cdnSelect}
								value={cdn()}
								onChange={(e) => setCdn(e.currentTarget.value as CDN)}
							>
								<option value="jsdelivr">jsDelivr</option>
								<option value="esm.sh">esm.sh</option>
								<option value="unpkg">unpkg</option>
							</select>
						</div>
					</div>

					{/* Suggestions from /_discover — shown as soon as discover data
					    matches the current draft input (updates as you type). */}
					<Show when={discoverData() && discoverPkg() === firstPkgInput()}>
						<div class={styles.suggestions}>
							<span class={styles.suggestLabel}>
								{discoverData()!.package}@{discoverData()!.version} exports:
							</span>
							<div class={styles.suggestChips}>
								<For each={discoverData()!.exports}>
									{(exp) => {
										const key = () => (exp.key === 'index' ? '' : exp.key);
										return (
											<button
												class={`${styles.chip}${key() === selectedExport() ? ` ${styles.chipActive}` : ''}`}
												onClick={() => {
													setSelectedExport(key());
													syncExportParam(key());
												}}
											>
												{exp.key === 'index'
													? discoverData()!.package
													: `${discoverData()!.package}/${exp.key}`}
											</button>
										);
									}}
								</For>
							</div>
						</div>
					</Show>
				</div>

				{/* ── Error ──────────────────────────────────────────────── */}
				<Show when={measureError()}>
					<p class={styles.error}>{measureError()}</p>
				</Show>

				{/* ── Results: waterfall + output tabs ───────────────────── */}
				<Show when={measuring()}>
					<section class={styles.results}>
						<span class={styles.spinner} aria-hidden="true">✜</span>
					</section>
				</Show>
				<Show when={!measuring() && resources() !== null && measuredEntries() !== null}>
					<section class={styles.results}>
						<Waterfall resources={resources()!} />
						<OutputTabs
							entries={measuredEntries()!}
							resources={resources()!}
							cdn={measuredCdn()}
						/>
					</section>
				</Show>

				{/* ── Badge ───────────────────────────────────────────────── */}
				<Show when={firstPkg()}>
					<BadgeGenerator pkg={firstPkg} />
				</Show>

				{/* ── Version history ─────────────────────────────────────── */}
				<BundleHistory
					pkg={firstPkg()}
					onLoading={handleLoading}
					selectedExport={selectedExport()}
					onExportChange={(k) => {
						setSelectedExport(k);
						syncExportParam(k);
					}}
					exports={discoverData()?.exports ?? null}
				/>
			</div>

			<Footer />

			<Show when={loading()}>
				<LoadingOverlay />
			</Show>
		</main>
	);
}
