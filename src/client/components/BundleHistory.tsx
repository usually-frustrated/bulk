import { batch, createEffect, createSignal, For, Show } from 'solid-js';
import styles from './BundleHistory.module.css';

interface VersionData {
	version: string;
	publishedAt: string;
	bytes_transfer: number | null;
	bytes_raw: number | null;
}

interface HistoryData {
	package: string;
	export: string;
	cdn: string;
	versions: VersionData[];
}

/** Best available size — prefer transfer (compressed, what the browser downloads) */
function bestBytes(v: VersionData): number | null {
	return v.bytes_transfer ?? v.bytes_raw ?? null;
}

function fmtBytes(b: number): string {
	if (b === 0) return '0 B';
	const units = ['B', 'kB', 'MB'];
	const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), units.length - 1);
	return (b / 1024 ** i).toFixed(1) + '\u202f' + units[i];
}

// ─── SVG chart layout ────────────────────────────────────────────────────────

const VW = 528;
const VH = 200;
const PAD = { t: 12, r: 12, b: 40, l: 56 } as const;
const PX = PAD.l;
const PY = PAD.t;
const PW = VW - PAD.l - PAD.r;
const PH = VH - PAD.t - PAD.b;

function toX(i: number, n: number): number {
	return PX + (n <= 1 ? PW / 2 : (i / (n - 1)) * PW);
}

function toY(bytes: number, maxBytes: number): number {
	return PY + PH - (bytes / maxBytes) * PH;
}

// ─── component ──────────────────────────────────────────────────────────────

interface Props {
	pkg: string;
	onLoading: (v: boolean) => void;
	selectedExport: string;
	onExportChange: (k: string) => void;
	exports: { key: string; path: string }[] | null;
}

export function BundleHistory(props: Props) {
	const [data, setData] = createSignal<HistoryData | null>(null);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [hoveredIdx, setHoveredIdx] = createSignal<number | null>(null);

	async function analyze() {
		const pkg = props.pkg.trim();
		if (!pkg) return;
		const exp = props.selectedExport.trim() || 'index';

		batch(() => {
			setLoading(true);
			setError(null);
			setData(null);
			setHoveredIdx(null);
		});
		props.onLoading(true);

		try {
			const res = await fetch(`/_bundle-history/${pkg}/${exp}?cdn=jsdelivr`);
			if (!res.ok) throw new Error(await res.text());
			setData((await res.json()) as HistoryData);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load history');
		} finally {
			setLoading(false);
			props.onLoading(false);
		}
	}

	// Re-analyze whenever pkg or selected export changes.
	createEffect(() => {
		const pkg = props.pkg; // tracked
		const exp = props.selectedExport; // tracked
		void exp;
		if (pkg.trim()) void analyze();
	});

	// ─── chart derivations ──────────────────────────────────────────────────

	const versions = () => data()?.versions ?? [];
	const maxBytes = () => Math.max(1, ...versions().flatMap((v) => (bestBytes(v) != null ? [bestBytes(v)!] : [])));

	const linePath = () => {
		const vs = versions();
		const mb = maxBytes();
		const pts = vs
			.map((v, i) => (bestBytes(v) != null ? `${toX(i, vs.length).toFixed(1)},${toY(bestBytes(v)!, mb).toFixed(1)}` : null))
			.filter(Boolean) as string[];
		return pts.length >= 2 ? 'M' + pts[0] + 'L' + pts.slice(1).join('L') : '';
	};

	const areaPath = () => {
		const vs = versions();
		const mb = maxBytes();
		const pts = vs
			.map((v, i) => (bestBytes(v) != null ? ([toX(i, vs.length), toY(bestBytes(v)!, mb)] as [number, number]) : null))
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
		const b = bestBytes(v);
		return { ...v, x: toX(idx, vs.length), y: b != null ? toY(b, maxBytes()) : null, bytes: b };
	};

	// ─── render ─────────────────────────────────────────────────────────────

	return (
		<section class={styles.bundleHistory}>
			<div class={styles.inputRow}>
				<button class={styles.analyzeBtn} onClick={analyze} disabled={loading()}>
					{loading() ? '…' : 'analyze'}
				</button>
			</div>

			<Show when={error()}>
				<p class={styles.error}>{error()}</p>
			</Show>

			<Show when={loading()}>
				<div class={styles.loading}>Loading version history...</div>
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
						{/* Y grid + labels */}
						<For each={yTicks()}>
							{(tick) => (
								<>
									<line x1={PX} y1={tick.y} x2={PX + PW} y2={tick.y} class={styles.gridLine} />
									<text
										x={PX - 6}
										y={tick.y}
										text-anchor="end"
										dominant-baseline="middle"
										class={styles.axisLabel}
									>
										{tick.label}
									</text>
								</>
							)}
						</For>

						{/* X labels */}
						<For each={xLabels()}>
							{({ x, label }) => (
								<text x={x} y={PY + PH + 16} text-anchor="middle" class={styles.axisLabel}>
									{label}
								</text>
							)}
						</For>

						<Show when={areaPath()}>
							<path d={areaPath()} class={styles.area} />
						</Show>

						<Show when={linePath()}>
							<path d={linePath()} fill="none" class={styles.line} />
						</Show>

						<For each={versions()}>
							{(v, i) => (
								<Show when={bestBytes(v) != null}>
									<circle
										cx={toX(i(), versions().length)}
										cy={toY(bestBytes(v)!, maxBytes())}
										r={4}
										class={styles.point}
										onMouseEnter={() => setHoveredIdx(i())}
									/>
								</Show>
							)}
						</For>

						<Show when={hoveredPoint()}>
							{(pt) => {
								const p = pt();
								const onRight = p.x < VW / 2;
								const tx = onRight ? p.x + 10 : p.x - 10;
								const ty = Math.max(PY + 4, (p.y ?? PY) - 28);
								const boxW = 94;

								return (
									<g class={styles.tooltipGroup}>
										<line x1={p.x} y1={PY} x2={p.x} y2={PY + PH} class={styles.crosshair} />
										<rect
											x={onRight ? tx : tx - boxW}
											y={ty}
											width={boxW}
											height={38}
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
										<text
											x={onRight ? tx + boxW / 2 : tx - boxW / 2}
											y={ty + 28}
											text-anchor="middle"
											class={styles.tooltipBytes}
										>
											{fmtBytes(p.bytes ?? 0)}
										</text>
									</g>
								);
							}}
						</Show>
					</svg>

					<div class={styles.chartFooter}>
						<span class={styles.statItem}>
							{versions().filter((v) => bestBytes(v) != null).length}&thinsp;/&thinsp;
							{versions().length} versions
						</span>
					</div>
				</div>
			</Show>

		</section>
	);
}
