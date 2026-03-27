import { createSignal, createEffect, on, Show, For, onMount, batch } from 'solid-js';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { WaterfallBanner } from './components/WaterfallBanner';
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

interface DetectedFormats {
	umd:      string | null;
	cjs:      string | null;
	systemjs: string | null;
	iife:     string | null;
}

interface DiscoverResult {
	package:          string;
	version:          string;
	exports:          { key: string; path: string }[];
	wildcardResolved: boolean;
	formats:          DetectedFormats;
	externalDeps:     string[];
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

// ─── App ──────────────────────────────────────────────────────────────────────

export function App() {
	// ── Inputs ─────────────────────────────────────────────────────────────────

	const initialPkg = getQueryParam('pkg') ?? 'react';
	const initialExport = getQueryParam('export');

	// pkgInput = live text-field value
	// pkg      = committed value (only updates when the user clicks check)
	const [pkgInput, setPkgInput] = createSignal(initialPkg);
	const [pkg, setPkg] = createSignal(initialPkg);
	const [cdn, setCdn] = createSignal<CDN>('jsdelivr');
	const [format, setFormat] = createSignal('esm');

	// Derived: committed package name only (no export suffix)
	const firstPkg = () => parseInput(pkg()).pkg;

	// ── Commit helpers ──────────────────────────────────────────────────────────

	/** Commit the current draft input as the active package. */
	function commitPkg() {
		setPkg(pkgInput());
	}

	// ── URL sync (pkg) ──────────────────────────────────────────────────────────
	// Called explicitly inside handleMeasure — URL only changes on button click.

	function syncPkgParam(p: string) {
		const params = new URLSearchParams(window.location.search);
		if (p && p !== 'react') {
			params.set('pkg', p);
		} else {
			params.delete('pkg');
		}
		params.delete('export');
		const qs = params.toString();
		history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
	}

	// ── Discovery ───────────────────────────────────────────────────────────────
	// Only populated by handleMeasure — no live/reactive fetching.

	const [discoverData, setDiscoverData] = createSignal<DiscoverResult | null>(null);

	// ── Measurement state ───────────────────────────────────────────────────────

	const [measuring, setMeasuring] = createSignal(false);
	const [measureError, setMeasureError] = createSignal<string | null>(null);
	const [resources, setResources] = createSignal<ResourceTimingEntry[] | null>(null);
	const [measuredEntries, setMeasuredEntries] = createSignal<MeasurementEntry[] | null>(null);
	const [measuredCdn, setMeasuredCdn] = createSignal<CDN>('jsdelivr');
	const [measuredInput, setMeasuredInput] = createSignal<string | null>(null);
	const [measuredExport, setMeasuredExport] = createSignal('');
	const [measuredFormat, setMeasuredFormat] = createSignal('esm');

	// ── Export selection ────────────────────────────────────────────────────────

	const [selectedExport, setSelectedExport] = createSignal(initialExport ?? '');

	// When the committed package actually changes (not just re-committed), reset export + discover data + results.
	let lastPkg = firstPkg();
	createEffect(on(firstPkg, (pkgName) => {
		if (pkgName !== lastPkg) {
			lastPkg = pkgName;
			setSelectedExport('');
			setFormat('esm');
			setDiscoverData(null);
			setResources(null);
			setMeasuredEntries(null);
		}
	}, { defer: true }));

	// ── isDirty ─────────────────────────────────────────────────────────────────
	// Button is active when input, CDN, or export differs from last measurement.

	const isDirty = () =>
		measuredInput() === null ||
		pkgInput() !== measuredInput() ||
		cdn() !== measuredCdn() ||
		selectedExport() !== measuredExport() ||
		format() !== measuredFormat();

	// inputDirty: pkg text field changed since last commit (exports list is stale)
	const inputDirty = () => pkgInput() !== pkg();

	// Reset all inputs back to the last measured state.
	function revertInputs() {
		if (measuredInput() !== null) {
			setPkgInput(measuredInput()!);
			setCdn(measuredCdn());
			setSelectedExport(measuredExport());
			setFormat(measuredFormat());
		} else {
			setPkgInput(pkg());
		}
	}

	// ── Measure handler ─────────────────────────────────────────────────────────
	// Commits the draft input, then runs browser measurement.

	const handleMeasure = async () => {
		// Commit the draft input before measuring and sync URL.
		commitPkg();
		const pkgName = parseInput(pkgInput()).pkg;
		if (!pkgName) return;
		syncPkgParam(pkgName);

		batch(() => {
			setMeasuring(true);
			setMeasureError(null);
			setResources(null);
			setMeasuredEntries(null);
		});

		try {
			// 1. Resolve version + exports via /_discover.
			// Skip re-fetch if we already have data for the same package — this
			// prevents the <For>-rendered options from re-rendering and losing the
			// controlled <select> value.
			const existing = discoverData();
			let dr: DiscoverResult;
			if (existing?.package === pkgName) {
				dr = existing;
			} else {
				const res0 = await fetch(`/_discover/${encodeURIComponent(pkgName)}`);
				if (!res0.ok) throw new Error(`Could not resolve ${pkgName}: ${res0.statusText}`);
				dr = (await res0.json()) as DiscoverResult;
				setDiscoverData(dr);
			}

			// 2. Single measurement entry: package + selected export
			const exportKey = selectedExport() || 'index';
			const entries: MeasurementEntry[] = [{ pkg: pkgName, version: dr.version, exportKey }];

			// 3. Run browser measurement in iframe
			const selectedCdn = cdn();
			const selectedFormat = format();
			const formats = dr.formats ?? {};
			const formatPath = selectedFormat !== 'esm'
				? (formats as Record<string, string | null>)[selectedFormat] ?? null
				: null;
			const rawResources = await measurePackages(entries, selectedCdn, selectedFormat, formatPath, dr.externalDeps ?? []);

			// 4. Report to /_record (fire-and-forget)
			// Include cached resources (transferSize may be 0) as long as we know the size.
			const annotated = rawResources.filter(
				(r) => r.pkg && typeof r.decodedBodySize === 'number' && r.decodedBodySize > 0,
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
				setMeasuredFormat(selectedFormat);
				setMeasuredInput(pkgInput());
				setMeasuredExport(selectedExport());
			});
		} catch (err) {
			setMeasureError(err instanceof Error ? err.message : 'Measurement failed');
		} finally {
			setMeasuring(false);
		}
	};

	// ── Banner copy ────────────────────────────────────────────────────────────
	const [copyBannerText, setCopyBannerText] = createSignal('copy url');
	const copyBannerUrl = async () => {
		const p = firstPkg() || 'zustand';
		const ver = measuredEntries()?.[0]?.version;
		const selectedCdn = cdn();
		const pkgAt = ver ? `${p}@${ver}` : p;
		const cdnParam = selectedCdn && selectedCdn !== 'jsdelivr' ? `?cdn=${encodeURIComponent(selectedCdn)}` : '';
		const url = `${window.location.origin}/_banner/standard/${pkgAt}${cdnParam}`;
		try {
			await navigator.clipboard.writeText(url);
			setCopyBannerText('copied!');
			setTimeout(() => setCopyBannerText('copy url'), 2000);
		} catch {}
	};

	// Auto-measure on initial load only when query params are present.
	onMount(() => { if (getQueryParam('pkg') !== null) void handleMeasure(); });

	// ── Render ──────────────────────────────────────────────────────────────────

	return (
		<main>
			<div class={`bleed-top bleed-bottom ${styles.frameWrap}`}>
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
							classList={{ [styles.runBtn]: true, [styles.runBtnDirty]: isDirty() }}
							onClick={handleMeasure}
							disabled={measuring() || !isDirty()}
							aria-label="measure"
						>&#x25B6; check</button>
						<button
							class={styles.revertBtn}
							onClick={revertInputs}
							title="revert changes"
							disabled={!isDirty() || measuredInput() === null}
						>&#x21A9;</button>
					</div>

					<div class={styles.controlsRow}>
						<div class={styles.exportGroup}>
							<label class={styles.inputLabel}>export</label>
							<select
								class={styles.exportSelect}
								value={selectedExport()}
								onChange={(e) => setSelectedExport(e.currentTarget.value)}
								disabled={!discoverData() || inputDirty()}
							>
								<Show when={!discoverData()}>
									<option value="">—</option>
								</Show>
								<For each={discoverData()?.exports ?? []}>
									{(exp, i) => {
										const key = exp.key === 'index' ? '' : exp.key;
										const label = i() === 0 ? 'default' : exp.key;
										return (
											<option value={key} style={i() === 0 ? 'color:var(--color-text-muted)' : ''}>
												{label}
											</option>
										);
									}}
								</For>
							</select>
						</div>

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

						<div class={styles.cdnGroup}>
							<label class={styles.inputLabel}>format</label>
							<select
								class={styles.cdnSelect}
								value={format()}
								onChange={(e) => setFormat(e.currentTarget.value)}
								disabled={inputDirty()}
							>
								<option value="esm">ESM</option>
								<option value="umd"      disabled={!discoverData()?.formats?.umd}>UMD</option>
								<option value="cjs"      disabled={!discoverData()?.formats?.cjs}>CJS</option>
								<option value="iife"     disabled={!discoverData()?.formats?.iife}>IIFE</option>
								<option value="systemjs" disabled={!discoverData()?.formats?.systemjs}>SystemJS</option>
							</select>
						</div>
					</div>
				</div>

				{/* ── Error ──────────────────────────────────────────────── */}
				<Show when={measureError()}>
					<p class={styles.error}>{measureError()}</p>
				</Show>

				{/* ── Results: waterfall + output tabs ───────────────────── */}
				<Show when={measuring()}>
					<section class={styles.results}>
						<div class={styles.spinnerWrap}>
							<span class={styles.spinner} aria-hidden="true">✜</span>
						</div>
					</section>
				</Show>
				<Show when={!measuring() && resources() !== null && measuredEntries() !== null}>
					<section classList={{ [styles.results]: true, [styles.resultsDimmed]: isDirty() }}>
						<div class={styles.headingRow}>
							<label class={styles.inputLabel}>banner</label>
							<button class={styles.copyButton} onClick={copyBannerUrl}>{copyBannerText()}</button>
						</div>
						<WaterfallBanner
							resources={resources()!}
							pkg={measuredEntries()![0]?.pkg ?? firstPkg()}
							version={measuredEntries()![0]?.version ?? ''}
							cdn={measuredCdn()}
							format={measuredFormat()}
						/>
					</section>
				</Show>

								</div>

			<Footer />
			</div>
		</main>
	);
}
