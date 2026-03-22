import { For, Show } from 'solid-js';
import type { MeasurementResult } from '../utils/measure';
import { CDNS } from '../utils/measure';
import styles from './Waterfall.module.css';

interface WaterfallProps {
	measurement: MeasurementResult | null;
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
	if (ms < 1) return '<1ms';
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

export function Waterfall(props: WaterfallProps) {
	const cdnName = () => {
		if (!props.measurement) return '';
		const cdn = CDNS.find(c => c.id === props.measurement!.cdn);
		return cdn?.name || props.measurement.cdn;
	};
	
	return (
		<Show when={props.measurement}>
			{(m) => (
				<div class={styles.container}>
					<div class={styles.header}>
						<h3 class={styles.title}>
							{m().exportPath === '.' ? 'Root' : m().exportPath} via {cdnName()}
						</h3>
						<div class={styles.summary}>
							<div class={styles.stat}>
								<span class={styles.statValue}>{m().files}</span>
								<span class={styles.statLabel}>files</span>
							</div>
							<div class={styles.stat}>
								<span class={styles.statValue}>{formatBytes(m().wireBytes)}</span>
								<span class={styles.statLabel}>wire</span>
							</div>
							<div class={styles.stat}>
								<span class={styles.statValue}>{formatBytes(m().parseBytes)}</span>
								<span class={styles.statLabel}>parse</span>
							</div>
							<div class={styles.stat}>
								<span class={styles.statValue}>{m().rounds}</span>
								<span class={styles.statLabel}>rounds</span>
							</div>
						</div>
					</div>
					
					<div class={styles.waterfall}>
						<For each={m().waterfall}>
							{(round) => (
								<div class={styles.round}>
									<div class={styles.roundHeader}>
										<span class={styles.roundNumber}>Round {round.round}</span>
										<span class={styles.roundFiles}>{round.files.length} parallel</span>
									</div>
									<div class={styles.roundFilesList}>
										<For each={round.files}>
											{(file) => {
												const url = new URL(file.url);
												const filename = url.pathname.split('/').pop() || url.pathname;
												return (
													<div class={styles.file}>
														<div class={styles.fileInfo}>
															<code class={styles.fileName}>{filename}</code>
															<span class={styles.fileUrl}>{url.hostname}</span>
														</div>
														<div class={styles.fileStats}>
															<span class={styles.fileSize}>{formatBytes(file.transferSize)}</span>
															<span class={styles.fileTime}>{formatDuration(file.responseEnd - file.startTime)}</span>
														</div>
													</div>
												);
											}}
										</For>
									</div>
								</div>
							)}
						</For>
					</div>
					
					<div class={styles.importmap}>
						<h4>Import URL</h4>
						<code class={styles.importCode}>
							{m().resources[0]?.url || 'N/A'}
						</code>
					</div>
				</div>
			)}
		</Show>
	);
}
