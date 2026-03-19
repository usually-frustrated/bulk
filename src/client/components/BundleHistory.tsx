import { batch, createSignal, For, onCleanup, Show } from 'solid-js';
import styles from './BundleHistory.module.css';

interface VersionData {
	version: string;
	publishedAt: string;
	bytes: number | null;
	jobId?: string;
}

interface HistoryData {
	package: string;
	export: string;
	versions: VersionData[];
}

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtBytes(b: number): string {
	if (b === 0) return '0 B';
	const units = ['B', 'kB', 'MB'];
	const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), units.length - 1);
	return (b / 1024 ** i).toFixed(1) + '\u202f' + units[i];
}

function fmtDate(iso: string): string {
	return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
}

// ─── SVG chart layout ────────────────────────────────────────────────────────

const VW = 528;
const VH = 200;
const PAD = { t: 12, r: 12, b: 40, l: 56 } as const;
// Plot area origin and dimensions (SVG user units)
const PX = PAD.l;
const PY = PAD.t;
const PW = VW - PAD.l - PAD.r; // 460
const PH = VH - PAD.t - PAD.b; // 148

function toX(i: number, n: number): number {
	return PX + (n <= 1 ? PW / 2 : (i / (n - 1)) * PW);
}

function toY(bytes: number, maxBytes: number): number {
	return PY + PH - (bytes / maxBytes) * PH;
}

// ─── component ──────────────────────────────────────────────────────────────

export function BundleHistory() {
	const [pkgInput, setPkgInput] = createSignal('');
	const [exportInput, setExportInput] = createSignal('');
	const [data, setData] = createSignal<HistoryData | null>(null);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [hoveredIdx, setHoveredIdx] = createSignal<number | null>(null);

	// Track open EventSource connections  (and polling intervals as fallback)
	const sseMap = new Map<string, EventSource>();
	const pollMap = new Map<string, ReturnType<typeof setInterval>>();

	onCleanup(() => {
		for (const s of sseMap.values()) s.close();
		for (const t of pollMap.values()) clearInterval(t);
	});

	function updateVersion(version: string, bytes: number) {
		setData((prev) => {
			if (!prev) return prev;
			return {
				...prev,
				versions: prev.versions.map((v) =>
					v.version === version ? { ...v, bytes, jobId: undefined } : v,
				),
			};
		});
	}

	function pollJob(jobId: string, version: string) {
		const id = setInterval(async () => {
			try {
				const res = await fetch(`/_bundle-status/${jobId}`);
				const body = (await res.json()) as { status: string; bytes?: number };
				if (body.status === 'completed' && body.bytes != null) {
					updateVersion(version, body.bytes);
					clearInterval(id);
					pollMap.delete(jobId);
				} else if (body.status === 'failed') {
					clearInterval(id);
					pollMap.delete(jobId);
				}
			} catch {
				/* network hiccup — keep polling */
			}
		}, 3000);
		pollMap.set(jobId, id);
	}

	function watchJob(jobId: string, version: string) {
		if (sseMap.has(jobId) || pollMap.has(jobId)) return;

		if (typeof EventSource === 'undefined') {
			pollJob(jobId, version);
			return;
		}

		const sse = new EventSource(`/_bundle-status/${jobId}`);
		sseMap.set(jobId, sse);

		const close = () => {
			sse.close();
			sseMap.delete(jobId);
		};

		sse.addEventListener('completed', (raw) => {
			const payload = JSON.parse((raw as MessageEvent).data) as { bytes: number };
			updateVersion(version, payload.bytes);
			close();
		});

		sse.addEventListener('failed', close);
		sse.addEventListener('timeout', () => {
			// Server gave up on SSE — switch to polling
			close();
			pollJob(jobId, version);
		});

		sse.onerror = () => {
			close();
			pollJob(jobId, version);
		};
	}

	async function analyze() {
		// Close any existing connections from a previous analysis
		for (const s of sseMap.values()) s.close();
		sseMap.clear();
		for (const t of pollMap.values()) clearInterval(t);
		pollMap.clear();

		const pkg = pkgInput().trim();
		if (!pkg) return;
		const exp = exportInput().trim() || 'index';

		batch(() => {
			setLoading(true);
			setError(null);
			setData(null);
			setHoveredIdx(null);
		});

		try {
			const res = await fetch(`/_bundle-history/${pkg}/${exp}`);
			if (!res.ok) throw new Error(await res.text());
			const json = (await res.json()) as HistoryData;
			setData(json);

			for (const v of json.versions) {
				if (v.jobId) watchJob(v.jobId, v.version);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load history');
		} finally {
			setLoading(false);
		}
	}

	// ─── chart derivations ──────────────────────────────────────────────────

	const versions = () => data()?.versions ?? [];
	const knownBytes = () => versions().flatMap((v) => (v.bytes != null ? [v.bytes] : []));
	const maxBytes = () => (knownBytes().length ? Math.max(...knownBytes()) : 1);

	const linePath = () => {
		const vs = versions();
		const mb = maxBytes();
		const pts = vs
			.map((v, i) => (v.bytes != null ? `${toX(i, vs.length).toFixed(1)},${toY(v.bytes, mb).toFixed(1)}` : null))
			.filter(Boolean) as string[];
		return pts.length >= 2 ? 'M' + pts[0] + 'L' + pts.slice(1).join('L') : '';
	};

	const areaPath = () => {
		const vs = versions();
		const mb = maxBytes();
		const pts = vs
			.map((v, i) => (v.bytes != null ? ([toX(i, vs.length), toY(v.bytes, mb)] as [number, number]) : null))
			.filter((p): p is [number, number] => p !== null);
		if (pts.length < 2) return '';
		const bottom = PY + PH;
		return (
			`M${pts[0][0].toFixed(1)},${bottom}` +
			pts.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join('') +
			`L${pts[pts.length - 1][0].toFixed(1)},${bottom}Z`
		);
	};

	const yTicks = () => {
		const mb = maxBytes();
		return [0, 0.25, 0.5, 0.75, 1].map((f) => ({
			y: PY + PH - f * PH,
			label: f === 0 ? '0' : fmtBytes(Math.round(f * mb)),
		}));
	};

	const xLabels = () => {
		const vs = versions();
		if (!vs.length) return [];
		const step = Math.ceil(vs.length / 6);
		const idxs = [0];
		for (let i = step; i < vs.length - 1; i += step) idxs.push(i);
		if (idxs[idxs.length - 1] !== vs.length - 1) idxs.push(vs.length - 1);
		return idxs.map((i) => ({ x: toX(i, vs.length), label: vs[i].version }));
	};

	const hoveredPoint = () => {
		const idx = hoveredIdx();
		const vs = versions();
		if (idx === null || idx >= vs.length) return null;
		const v = vs[idx];
		return {
			...v,
			x: toX(idx, vs.length),
			y: v.bytes != null ? toY(v.bytes, maxBytes()) : null,
		};
	};

	const computedCount = () => versions().filter((v) => v.bytes != null).length;
	const hasPending = () => versions().some((v) => v.jobId);

	// ─── render ─────────────────────────────────────────────────────────────

	return (
		<section class={styles.bundleHistory}>
			<label class={styles.sectionLabel}>Bundle size history</label>

			<div class={styles.inputRow}>
				<input
					type="text"
					class={styles.inputPkg}
					placeholder="package (e.g., react)"
					value={pkgInput()}
					onInput={(e) => setPkgInput(e.currentTarget.value)}
					onKeyDown={(e) => e.key === 'Enter' && analyze()}
				/>
				<input
					type="text"
					class={styles.inputExport}
					placeholder="export (default: index)"
					value={exportInput()}
					onInput={(e) => setExportInput(e.currentTarget.value)}
					onKeyDown={(e) => e.key === 'Enter' && analyze()}
				/>
				<button class={styles.analyzeBtn} onClick={analyze} disabled={loading()}>
					{loading() ? '…' : 'analyze'}
				</button>
			</div>

			<Show when={error()}>
				<p class={styles.error}>{error()}</p>
			</Show>

			<Show when={data()}>
				<div class={styles.chartWrap}>
					<svg
						width="100%"
						height={VH}
						viewBox={`0 0 ${VW} ${VH}`}
						preserveAspectRatio="xMidYMid meet"
						class={styles.chart}
						onMouseLeave={() => setHoveredIdx(null)}
					>
						{/* horizontal grid lines + Y labels */}
						<For each={yTicks()}>
							{(tick) => (
								<>
									<line
										x1={PX}
										y1={tick.y}
										x2={PX + PW}
										y2={tick.y}
										class={styles.gridLine}
									/>
									<text x={PX - 6} y={tick.y} text-anchor="end" dominant-baseline="middle" class={styles.axisLabel}>
										{tick.label}
									</text>
								</>
							)}
						</For>

						{/* X version labels */}
						<For each={xLabels()}>
							{({ x, label }) => (
								<text
									x={x}
									y={PY + PH + 16}
									text-anchor="middle"
									class={styles.axisLabel}
								>
									{label}
								</text>
							)}
						</For>

						{/* area fill */}
						<Show when={areaPath()}>
							<path d={areaPath()} class={styles.area} />
						</Show>

						{/* line */}
						<Show when={linePath()}>
							<path d={linePath()} fill="none" class={styles.line} />
						</Show>

						{/* data points */}
						<For each={versions()}>
							{(v, i) => {
								const x = () => toX(i(), versions().length);
								const y = () => (v.bytes != null ? toY(v.bytes, maxBytes()) : PY + PH / 2);
								return (
									<circle
										cx={x()}
										cy={y()}
										r={v.bytes != null ? 4 : 3}
										class={v.bytes != null ? styles.point : styles.pointPending}
										onMouseEnter={() => setHoveredIdx(i())}
									/>
								);
							}}
						</For>

						{/* tooltip */}
						<Show when={hoveredPoint()}>
							{(pt) => {
								const p = pt();
								const onRight = p.x < VW / 2;
								const tx = onRight ? p.x + 10 : p.x - 10;
								const ty = Math.max(PY + 4, (p.y ?? PY + PH / 2) - 28);
								const boxW = 94;
								const boxH = p.bytes != null ? 38 : 26;

								return (
									<g class={styles.tooltipGroup}>
										{/* vertical crosshair */}
										<line
											x1={p.x}
											y1={PY}
											x2={p.x}
											y2={PY + PH}
											class={styles.crosshair}
										/>
										<rect
											x={onRight ? tx : tx - boxW}
											y={ty}
											width={boxW}
											height={boxH}
											rx={2}
											class={styles.tooltipBox}
										/>
										<text
											x={onRight ? tx + boxW / 2 : tx - boxW / 2}
											y={ty + 13}
											text-anchor="middle"
											class={styles.tooltipVersion}
										>
											v{p.version}
										</text>
										<Show when={p.bytes != null}>
											<text
												x={onRight ? tx + boxW / 2 : tx - boxW / 2}
												y={ty + 28}
												text-anchor="middle"
												class={styles.tooltipBytes}
											>
												{fmtBytes(p.bytes!)}
											</text>
										</Show>
										<Show when={p.bytes == null}>
											<text
												x={onRight ? tx + boxW / 2 : tx - boxW / 2}
												y={ty + 20}
												text-anchor="middle"
												class={styles.tooltipPending}
											>
												computing…
											</text>
										</Show>
									</g>
								);
							}}
						</Show>
					</svg>

					<div class={styles.chartFooter}>
						<span class={styles.statItem}>
							{computedCount()}&thinsp;/&thinsp;{versions().length} versions analyzed
						</span>
						<Show when={hasPending()}>
							<span class={styles.computing}>computing remaining…</span>
						</Show>
					</div>
				</div>
			</Show>
		</section>
	);
}
