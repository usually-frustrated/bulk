import { For, Show, createSignal } from 'solid-js';
import type { MeasurementResult, CdnId } from '../utils/measure';
import { CDNS } from '../utils/measure';
import styles from './SummaryTable.module.css';

interface SummaryTableProps {
	pkg: string;
	version: string;
	exports: string[];
	measurements: Record<string, Record<CdnId, MeasurementResult>>;
	onSelectExport: (exportPath: string) => void;
	selectedExport: string | null;
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return '—';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function findBestCdn(measurements: Record<CdnId, MeasurementResult>): CdnId | null {
	const validMeasurements = Object.entries(measurements).filter(([, m]) => m.wireBytes > 0);
	if (validMeasurements.length === 0) return null;
	
	const sorted = validMeasurements.sort(([, a], [, b]) => a.wireBytes - b.wireBytes);
	return sorted[0][0] as CdnId;
}

export function SummaryTable(props: SummaryTableProps) {
	const [expandedExport, setExpandedExport] = createSignal<string | null>(null);
	
	const toggleExpand = (exportPath: string) => {
		const current = expandedExport();
		const newValue = current === exportPath ? null : exportPath;
		setExpandedExport(newValue);
		props.onSelectExport(newValue || '');
	};
	
	return (
		<div class={styles.container}>
			<h2 class={styles.title}>
				{props.pkg}@{props.version}
			</h2>
			
			<table class={styles.table}>
				<thead>
					<tr>
						<th class={styles.colExport}>Export</th>
						<For each={CDNS}>
							{(cdn) => <th class={styles.colCdn}>{cdn.name}</th>}
						</For>
						<th class={styles.colBest}>Best</th>
					</tr>
				</thead>
				<tbody>
					<For each={props.exports}>
						{(exportPath) => {
							const measurement = () => props.measurements[exportPath];
							const bestCdn = () => findBestCdn(measurement() || {} as Record<CdnId, MeasurementResult>);
							const isExpanded = () => expandedExport() === exportPath;
							
							return (
								<>
									<tr 
										class={styles.row}
										classList={{ [styles.expanded]: isExpanded() }}
										onClick={() => toggleExpand(exportPath)}
									>
										<td class={styles.colExport}>
											<code>{exportPath === '.' ? './ (root)' : `./${exportPath}`}</code>
										</td>
										<For each={CDNS}>
											{(cdn) => {
												const m = measurement()?.[cdn.id];
												return (
													<td class={styles.colCdn}>
														<Show 
															when={m && m.wireBytes > 0}
															fallback={<span class={styles.noData}>—</span>}
														>
															<div class={styles.sizeCell}>
																<span class={styles.wireSize}>{formatBytes(m!.wireBytes)}</span>
																<span class={styles.fileCount}>{m!.files} files</span>
															</div>
														</Show>
													</td>
												);
											}}
										</For>
										<td class={styles.colBest}>
											<Show when={bestCdn()} fallback={<span class={styles.noData}>—</span>}>
												{(cdnId) => {
													const cdn = CDNS.find(c => c.id === cdnId())!;
													return <span class={styles.bestCdn}>{cdn.name}</span>;
												}}
											</Show>
										</td>
									</tr>
								</>
							);
						}}
					</For>
				</tbody>
			</table>
		</div>
	);
}
