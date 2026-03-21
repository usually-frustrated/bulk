import { createEffect, createSignal, For, Show } from 'solid-js';
import styles from './ExportsTable.module.css';

interface ExportRow {
	key: string;
	badgePath: string;
}

function exportsToRows(pkg: string, exportsField: Record<string, unknown> | string | null | undefined): ExportRow[] {
	if (!exportsField || typeof exportsField === 'string') {
		return [{ key: '.', badgePath: `/${pkg}` }];
	}
	return Object.keys(exportsField)
		.filter((k) => k.startsWith('.'))
		.map((k) => ({
			key: k,
			badgePath: k === '.' ? `/${pkg}` : `/${pkg}/${k.replace(/^\.\//, '')}`,
		}));
}

interface Props {
	pkg: string;
	onLoading: (v: boolean) => void;
}

export function ExportsTable(props: Props) {
	const [rows, setRows] = createSignal<ExportRow[]>([]);
	const [error, setError] = createSignal<string | null>(null);
	const [copyState, setCopyState] = createSignal<Record<string, string>>({});

	const domain = window.location.origin;

	async function load(pkg: string) {
		if (!pkg) return;
		props.onLoading(true);
		setError(null);
		setRows([]);
		try {
			const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`);
			if (!res.ok) throw new Error(`Package "${pkg}" not found`);
			const data = await res.json();
			setRows(exportsToRows(pkg, data.exports));
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Failed to load package info');
		} finally {
			props.onLoading(false);
		}
	}

	createEffect(() => {
		load(props.pkg);
	});

	async function copy(path: string) {
		const url = `${domain}${path}`;
		try {
			await navigator.clipboard.writeText(url);
			setCopyState((s) => ({ ...s, [path]: 'copied!' }));
			setTimeout(() => setCopyState((s) => ({ ...s, [path]: '' })), 2000);
		} catch {}
	}

	return (
		<section class={styles.exportsTable}>
			<label class={styles.sectionLabel}>Badges</label>
			<Show when={error()}>
				<p class={styles.error}>{error()}</p>
			</Show>
			<Show when={rows().length > 0}>
				<table class={styles.table}>
					<tbody>
						<For each={rows()}>
							{(row) => (
								<tr class={styles.row}>
									<td class={styles.badgeCell}>
										<img src={`${domain}${row.badgePath}`} alt={row.key} />
									</td>
									<td class={styles.urlCell}>
										<code class={styles.url}>{`${domain}${row.badgePath}`}</code>
									</td>
									<td class={styles.copyCell}>
										<button class={styles.copyBtn} onClick={() => copy(row.badgePath)}>
											{copyState()[row.badgePath] || 'copy'}
										</button>
									</td>
								</tr>
							)}
						</For>
					</tbody>
				</table>
			</Show>
		</section>
	);
}
