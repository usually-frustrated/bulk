import { For, Show } from 'solid-js';
import type { ResourceTimingEntry } from '../utils/measurement';
import styles from './Waterfall.module.css';

interface WaterfallProps {
	resources: ResourceTimingEntry[];
}

interface Round {
	number: number;
	offsetMs: number; // ms from t=0
	resources: ResourceTimingEntry[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtBytes(n: number | null): string {
	if (n === null || n === undefined) return '-';
	if (n === 0) return '0 B';
	if (n < 1024) return `${n}\u202fB`;
	return `${(n / 1024).toFixed(1)}\u202fkB`;
}

function fmtMs(ms: number): string {
	return `${ms.toFixed(0)}\u202fms`;
}

function filename(url: string): string {
	try {
		const u = new URL(url);
		const parts = u.pathname.split('/').filter(Boolean);
		return parts[parts.length - 1] || u.hostname;
	} catch {
		return url.slice(0, 40);
	}
}

/**
 * Group resources into sequential rounds.
 * Resources whose startTime is within `gapMs` of the previous one are
 * considered parallel (same round). A larger gap opens a new round.
 */
function groupIntoRounds(resources: ResourceTimingEntry[], gapMs = 5): Round[] {
	if (!resources.length) return [];

	const sorted = [...resources].sort((a, b) => a.startTime - b.startTime);
	const t0 = sorted[0].startTime;

	const rounds: Round[] = [];
	let current: ResourceTimingEntry[] = [sorted[0]];
	let prevStart = sorted[0].startTime;

	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i].startTime - prevStart > gapMs) {
			rounds.push({ number: rounds.length + 1, offsetMs: current[0].startTime - t0, resources: current });
			current = [];
		}
		current.push(sorted[i]);
		prevStart = sorted[i].startTime;
	}
	if (current.length) {
		rounds.push({ number: rounds.length + 1, offsetMs: current[0].startTime - t0, resources: current });
	}
	return rounds;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function Waterfall(props: WaterfallProps) {
	const t0 = () =>
		props.resources.length ? Math.min(...props.resources.map((r) => r.startTime)) : 0;

	const tMax = () =>
		props.resources.length ? Math.max(...props.resources.map((r) => r.responseEnd)) : 1;

	const span = () => Math.max(1, tMax() - t0());

	const rounds = () => groupIntoRounds(props.resources);

	const totalTransfer = () => props.resources.reduce((s, r) => s + (r.transferSize ?? 0), 0);
	const totalDecoded = () => props.resources.reduce((s, r) => s + (r.decodedBodySize ?? 0), 0);

	const barLeft = (r: ResourceTimingEntry) => ((r.startTime - t0()) / span()) * 100;
	const barWidth = (r: ResourceTimingEntry) =>
		Math.max(0.4, ((r.responseEnd - r.startTime) / span()) * 100);

	return (
		<div class={styles.waterfall}>
			<div class={styles.totals}>
				<span>{props.resources.length} files</span>
				<span>{fmtBytes(totalTransfer())} wire</span>
				<span>{fmtBytes(totalDecoded())} parsed</span>
				<span>
					{rounds().length} round trip{rounds().length !== 1 ? 's' : ''}
				</span>
				<span>{fmtMs(span())} total</span>
			</div>

			<For each={rounds()}>
				{(round) => (
					<div class={styles.round}>
						<div class={styles.roundHeader}>
							<span class={styles.roundLabel}>round {round.number}</span>
							<span class={styles.roundOffset}>+{fmtMs(round.offsetMs)}</span>
						</div>
						<For each={round.resources}>
							{(r) => (
								<div class={styles.barRow}>
									<div class={styles.meta}>
										<span class={styles.fname} title={r.url}>
											{filename(r.url)}
										</span>
										<span class={styles.size}>{fmtBytes(r.transferSize || r.decodedBodySize)}</span>
									</div>
									<div class={styles.track}>
										<div
											class={styles.bar}
											style={{
												left: `${barLeft(r).toFixed(2)}%`,
												width: `${barWidth(r).toFixed(2)}%`,
											}}
											title={`${r.url}\n${fmtMs(r.responseEnd - r.startTime)}`}
										/>
									</div>
								</div>
							)}
						</For>
					</div>
				)}
			</For>

			<Show when={!props.resources.length}>
				<p class={styles.empty}>No resources recorded.</p>
			</Show>
		</div>
	);
}
