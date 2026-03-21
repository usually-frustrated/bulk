import { createEffect, createSignal, For, Show } from 'solid-js';
import styles from './ExportsTable.module.css';

interface ExportRow {
	key: string;
	badgePath: string;
}

function toRow(pkg: string, key: string, cdn: string): ExportRow {
	const suffix = key === '.' ? `/${pkg}` : `/${pkg}/${key.replace(/^\.\//, '')}`;
	return { key, badgePath: `/${cdn}${suffix}` };
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

async function resolveExports(pkg: string): Promise<string[]> {
	const pkgRes = await fetch(`https://registry.npmjs.org/${pkg}/latest`);
	if (!pkgRes.ok) throw new Error(`Package "${pkg}" not found`);
	const pkgData = await pkgRes.json();

	const exportsField = pkgData.exports as Record<string, unknown> | string | null | undefined;

	if (!exportsField || typeof exportsField === 'string') {
		return ['.'];
	}

	const allKeys = Object.keys(exportsField).filter(
		(k) => k.startsWith('.') && !k.endsWith('package.json'),
	);
	const wildcardKeys = allKeys.filter((k) => k.includes('*'));
	const namedKeys = allKeys.filter((k) => !k.includes('*'));

	if (wildcardKeys.length === 0) {
		return namedKeys.sort((a, b) => (a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b)));
	}

	// Has wildcard patterns — discover actual files via unpkg
	const discovered: string[] = [];
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
				const stem = file.slice(1).replace(/\.(m)?js$/, '');
				if (stem === 'index') continue;
				const exportKey = `./${stem}`;
				if (namedKeys.includes(exportKey)) continue;
				if (wildcardKeys.some((p) => matchesWildcard(exportKey, p))) {
					discovered.push(exportKey);
				}
			}
		}
	} catch {
		// fallback to named only
	}

	return [...namedKeys, ...discovered].sort((a, b) =>
		a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b),
	);
}

interface Props {
	pkg: string;
	cdn: string;
	onLoading: (v: boolean) => void;
}

export function ExportsTable(props: Props) {
	const [exportKeys, setExportKeys] = createSignal<string[]>([]);
	const [error, setError] = createSignal<string | null>(null);
	const [copyState, setCopyState] = createSignal<Record<string, string>>({});

	const domain = window.location.origin;

	// Re-fetch export keys only when the package changes
	createEffect(() => {
		const pkg = props.pkg;
		if (!pkg) return;
		setError(null);
		setExportKeys([]);
		props.onLoading(true);
		resolveExports(pkg)
			.then((rows) => setExportKeys(rows.map((r) => r.key)))
			.catch((e) => setError(e instanceof Error ? e.message : 'Failed to load package info'))
			.finally(() => props.onLoading(false));
	});

	// Derive rows from keys + cdn (no fetch needed when cdn changes)
	const rows = () => exportKeys().map((k) => toRow(props.pkg, k, props.cdn));

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
