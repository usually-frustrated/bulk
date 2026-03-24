import { batch, createEffect, createSignal, For, Show } from 'solid-js';
import styles from './BundleHistory.module.css';

interface VersionMeta {
	version: string;
	publishedAt: string;
}

interface VersionSize {
	bytes_transfer: number | null;
	bytes_raw: number | null;
}

function bestBytes(s: VersionSize): number | null {
	return s.bytes_transfer ?? s.bytes_raw ?? null;
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
	selectedExport: string;
	onVersionClick?: (version: string) => void;
}

export function BundleHistory(props: Props) {
	const [versions, setVersions] = createSignal<VersionMeta[]>([]);
	const [sizes, setSizes] = createSignal<Map<string, VersionSize>>(new Map());
	const [loadingVersions, setLoadingVersions] = createSignal(false);
	const [generating, setGenerating] = createSignal(false);
	const [pendingDot, setPendingDot] = createSignal<string | null>(null);
	const [error, setError] = createSignal<string | null>(null);
	const [hoveredIdx, setHoveredIdx] = createSignal<number | null>(null);

	// Fetch just the version list (cheap) whenever pkg changes
	createEffect(() => {
		const pkg = props.pkg.trim();
		if (!pkg) return;
		void fetchVersionList(pkg);
	});

	async function fetchVersionList(pkg: string) {
		batch(() => {
			setLoadingVersions(true);
			setError(null);
			setVersions([]);
			setSizes(new Map());
		});
		try {
			const res = await fetch(`/_versions/${encodeURIComponent(pkg)}`);
			if (!res.ok) throw new Error(await res.text());
			const data = (await res.json()) as { versions: VersionMeta[] };
			setVersions(data.versions);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load versions');
		} finally {
			setLoadingVersions(false);
		}
	}

	async function fetchSizeForVersion(pkg: string, version: string, exportKey: string) {
		const path = exportKey && exportKey !== 'index'
			? `/_bundle/${encodeURIComponent(pkg)}@${encodeURIComponent(version)}/${exportKey}?cdn=jsdelivr`
			: `/_bundle/${encodeURIComponent(pkg)}@${encodeURIComponent(version)}?cdn=jsdelivr`;
		try {
			const res = await fetch(path);
			if (!res.ok) return null;
			return (await res.json()) as VersionSize;
		} catch {
			return null;
		}
	}

	async function handleDotClick(version: string) {
		if (pendingDot() || generating()) return;
		const pkg = props.pkg.trim();
		const exportKey = props.selectedExport || 'index';
		// For blank dots (no size yet), update the input to pin this version
		if (!sizes().has(version)) {
			props.onVersionClick?.(version);
		}
		setPendingDot(version);
		try {
			const size = await fetchSizeForVersion(pkg, version, exportKey);
			if (size) {
				setSizes((prev) => new Map([...prev, [version, size]]));
			}
		} finally {
			setPendingDot(null);
		}
	}

	async function handleGenerate() {
		const pkg = props.pkg.trim();
		if (!pkg || generating()) return;
		const exportKey = props.selectedExport || 'index';
		setGenerating(true);
		try {
			// Fetch all versions in parallel, streaming results in as they arrive
			const vs = versions();
			await Promise.all(
				vs.map(async (v) => {
					if (sizes().has(v.version)) return; // already fetched
					const size = await fetchSizeForVersion(pkg, v.version, exportKey);
					if (size) {
						setSizes((prev) => new Map([...prev, [v.version, size]]));
					}
				}),
			);
		} finally {
			setGenerating(false);
		}
	}

	// ─── chart derivations ──────────────────────────────────────────────────

	const filledVersions = () => {
		const sz = sizes();
		return versions().filter((v) => {
			const s = sz.get(v.version);
			return s != null && bestBytes(s) != null;
		});
	};

	const maxBytes = () =>
		Math.max(1, ...filledVersions().flatMap((v) => {
			const b = bestBytes(sizes().get(v.version)!);
			return b != null ? [b] : [];
		}));

	const linePath = () => {
		const vs = versions();
		const sz = sizes();
		const mb = maxBytes();
		const pts = vs
			.map((v, i) => {
				const s = sz.get(v.version);
				const b = s ? bestBytes(s) : null;
				return b != null ? `${toX(i, vs.length).toFixed(1)},${toY(b, mb).toFixed(1)}` : null;
			})
			.filter(Boolean) as string[];
		return pts.length >= 2 ? 'M' + pts[0] + 'L' + pts.slice(1).join('L') : '';
	};

	const areaPath = () => {
		const vs = versions();
		const sz = sizes();
		const mb = maxBytes();
		const pts = vs
			.map((v, i) => {
				const s = sz.get(v.version);
				const b = s ? bestBytes(s) : null;
				return b != null ? ([toX(i, vs.length), toY(b, mb)] as [number, number]) : null;
			})
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
		if (filledVersions().length === 0) return [];
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
		const sz = sizes();
		const s = sz.get(v.version);
		const b = s ? bestBytes(s) : null;
		return {
			version: v.version,
			x: toX(idx, vs.length),
			y: b != null ? toY(b, maxBytes()) : null,
			bytes: b,
		};
	};

	// ─── render ─────────────────────────────────────────────────────────────

	return (
		<section class={styles.bundleHistory}>
			<Show when={error()}>
				<p class={styles.error}>{error()}</p>
			</Show>

			<Show when={loadingVersions()}>
				<div class={styles.loading}>Loading versions…</div>
			</Show>

			<Show when={!loadingVersions() && versions().length > 0}>
				<div class={styles.chartWrap}>
					<svg
						width="100%"
						height={VH}
						viewBox={`0 0 ${VW} ${VH}`}
						preserveAspectRatio="xMidYMid meet"
						class={styles.chart}
						onMouseLeave={() => setHoveredIdx(null)}
					>
						{/* Y grid + labels (only when there's data) */}
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

						{/* Baseline */}
						<line x1={PX} y1={PY + PH} x2={PX + PW} y2={PY + PH} class={styles.gridLine} />

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

						{/* Dots — hollow if no data, filled if fetched */}
						<For each={versions()}>
							{(v, i) => {
								const sz = sizes();
								const s = sz.get(v.version);
								const b = s ? bestBytes(s) : null;
								const isPending = () => pendingDot() === v.version;
								const cx = toX(i(), versions().length);
								const cy = b != null ? toY(b, maxBytes()) : PY + PH / 2;
								return (
									<circle
										cx={cx}
										cy={cy}
										r={b != null ? 4 : 3}
										classList={{
											[styles.point]: b != null,
											[styles.pointEmpty]: b == null && !isPending(),
											[styles.pointPending]: isPending(),
										}}
										onMouseEnter={() => setHoveredIdx(i())}
										onClick={() => void handleDotClick(v.version)}
									/>
								);
							}}
						</For>

						<Show when={hoveredPoint()}>
							{(pt) => {
								const p = pt();
								const onRight = p.x < VW / 2;
								const tx = onRight ? p.x + 10 : p.x - 10;
								const ty = Math.max(PY + 4, (p.y ?? PY + PH / 2) - 28);
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
											{p.bytes != null ? fmtBytes(p.bytes) : 'click to generate'}
										</text>
									</g>
								);
							}}
						</Show>
					</svg>

					<div class={styles.chartFooter}>
						<span class={styles.statItem}>
							{sizes().size}&thinsp;/&thinsp;{versions().length} versions measured
						</span>
						<button
							class={styles.generateBtn}
							onClick={handleGenerate}
							disabled={generating() || sizes().size === versions().length}
						>
							{generating() ? '…' : 'generate all'}
						</button>
					</div>
				</div>
			</Show>
		</section>
	);
}
