import { createEffect, createSignal, For, Show } from 'solid-js';
import styles from './ExportsTable.module.css';

interface ExportRow {
	key: string;
	badgePath: string;
}

function toRow(pkg: string, key: string): ExportRow {
	return {
		key,
		badgePath: key === '.' ? `/${pkg}` : `/${pkg}/${key.replace(/^\.\//, '')}`,
	};
}

function matchesWildcard(key: string, pattern: string): boolean {
	if (!pattern.includes('*')) return key === pattern;
	const [before, after] = pattern.split('*');
	return key.startsWith(before) && key.endsWith(after) && key.length >= before.length + after.length;
}

function flatFiles(node: { type: string; path: string; files?: unknown[] }): string[] {
	if (node.type === 'file') return [node.path];
	return ((node.files ?? []) as typeof node[]).flatMap(flatFiles);
}

async function resolveExports(pkg: string): Promise<ExportRow[]> {
	const pkgRes = await fetch(`https://registry.npmjs.org/${pkg}/latest`);
	if (!pkgRes.ok) throw new Error(`Package "${pkg}" not found`);
	const pkgData = await pkgRes.json();

	const exportsField = pkgData.exports as Record<string, unknown> | string | null | undefined;

	if (!exportsField || typeof exportsField === 'string') {
		return [toRow(pkg, '.')];
	}

	const allKeys = Object.keys(exportsField).filter(
		(k) => k.startsWith('.') && !k.endsWith('package.json'),
	);
	const wildcardKeys = allKeys.filter((k) => k.includes('*'));
	const namedKeys = allKeys.filter((k) => !k.includes('*'));

	if (wildcardKeys.length === 0) {
		// All exports are explicitly named — simple case
		return namedKeys
			.map((k) => toRow(pkg, k))
			.sort((a, b) => (a.key === '.' ? -1 : b.key === '.' ? 1 : a.key.localeCompare(b.key)));
	}

	// Has wildcard patterns — discover actual files via unpkg
	let discovered: ExportRow[] = [];
	try {
		const metaRes = await fetch(`https://unpkg.com/${pkg}/?meta`);
		if (metaRes.ok) {
			const meta = await metaRes.json();
			const skipDirs = ['/esm/', '/cjs/', '/dist/', '/src/', '/umd/', '/lib/', '/.'];
			const jsFiles = flatFiles(meta).filter(
				(f) =>
					(f.endsWith('.js') || f.endsWith('.mjs')) &&
					!skipDirs.some((d) => f.includes(d)),
			);

			for (const file of jsFiles) {
				const stem = file.slice(1).replace(/\.(m)?js$/, ''); // "middleware.js" → "middleware"
				if (stem === 'index') continue;
				const exportKey = `./${stem}`;
				if (namedKeys.includes(exportKey)) continue;
				if (wildcardKeys.some((p) => matchesWildcard(exportKey, p))) {
					discovered.push(toRow(pkg, exportKey));
				}
			}
		}
	} catch {
		// fallback to named only
	}

	return [...namedKeys.map((k) => toRow(pkg, k)), ...discovered].sort((a, b) =>
		a.key === '.' ? -1 : b.key === '.' ? 1 : a.key.localeCompare(b.key),
	);
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

	createEffect(() => {
		const pkg = props.pkg;
		if (!pkg) return;
		setError(null);
		setRows([]);
		props.onLoading(true);
		resolveExports(pkg)
			.then(setRows)
			.catch((e) => setError(e instanceof Error ? e.message : 'Failed to load package info'))
			.finally(() => props.onLoading(false));
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
										<img src={`${domain}${row.badgePath}`} class={styles.badgeImg} alt={row.key} />
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
