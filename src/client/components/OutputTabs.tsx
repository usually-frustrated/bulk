import { createSignal, createResource, For, Show } from 'solid-js';
import type { MeasurementEntry, ResourceTimingEntry } from '../utils/measurement';
import { buildImportmapUrl, buildBareSpecifier } from '../utils/measurement';
import styles from './OutputTabs.module.css';

type TabId = 'importmap' | 'imports' | 'scripttags';

interface OutputTabsProps {
	entries: MeasurementEntry[];
	resources: ResourceTimingEntry[];
	cdn: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Pick the actual fetched URL for an entry (exact importmap URL preferred). */
function resolveUrl(e: MeasurementEntry, resources: ResourceTimingEntry[], cdn: string): string {
	const constructed = buildImportmapUrl(e.pkg, e.version, e.exportKey, cdn);
	const match = resources.find((r) => r.url === constructed);
	return match?.url ?? constructed;
}

function buildImportmap(
	entries: MeasurementEntry[],
	resources: ResourceTimingEntry[],
	cdn: string,
): string {
	const imports: Record<string, string> = {};
	for (const e of entries) {
		imports[buildBareSpecifier(e.pkg, e.exportKey)] = resolveUrl(e, resources, cdn);
	}
	return JSON.stringify({ imports }, null, 2);
}

function buildEsmImports(
	entries: MeasurementEntry[],
	resources: ResourceTimingEntry[],
	cdn: string,
): string {
	return entries
		.map((e) => `import '${resolveUrl(e, resources, cdn)}';`)
		.join('\n');
}

// ─── UMD detection ───────────────────────────────────────────────────────────

interface UmdInfo {
	pkg: string;
	version: string;
	umdUrl: string | null;
	globalName: string | null;
}

const UMD_GLOBALS: Record<string, string> = {
	react: 'React',
	'react-dom': 'ReactDOM',
	'react-dom/client': 'ReactDOM',
	vue: 'Vue',
	lodash: '_',
	moment: 'moment',
	axios: 'axios',
	jquery: 'jQuery',
	rxjs: 'rxjs',
	d3: 'd3',
};

function guessGlobal(pkg: string): string {
	const known = UMD_GLOBALS[pkg];
	if (known) return known;
	// @scope/name → ScopeName, foo-bar → FooBar
	const name = pkg.replace(/^@[^/]+\//, '');
	return name
		.split(/[-_/]/)
		.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
		.join('');
}

async function fetchUmdInfo(pkg: string, version: string): Promise<UmdInfo> {
	// Use the same URL format as wildcard.ts (no encodeURIComponent — jsDelivr
	// expects the raw @scope/name format, not %40scope%2Fname).
	const url = `https://data.jsdelivr.com/v1/package/npm/${pkg}@${version}/flat`;
	try {
		const res = await fetch(url);
		if (!res.ok) return { pkg, version, umdUrl: null, globalName: null };
		const data = (await res.json()) as { files?: { name: string }[] };
		const files = (data.files ?? []).map((f) => f.name.replace(/^\//, ''));

		// Non-ESM JS files only (exclude .mjs, .esm.js, .module.js)
		const isEsm = (f: string) => /\.(mjs|esm\.js|module\.js)$/.test(f);

		const candidates = [
			// umd/ directory (React 18, React-DOM, etc.)
			files.find((f) => /umd\/.*production\.min\.js$/.test(f) && !isEsm(f)),
			files.find((f) => /umd\/.*\.min\.js$/.test(f) && !isEsm(f)),
			// .umd.min.js / .umd.prod.min.js in filename (Vue, Pinia, etc.)
			files.find((f) => /\.umd\.prod\.min\.js$/.test(f)),
			files.find((f) => /\.umd\.min\.js$/.test(f)),
			files.find((f) => /\.umd\.js$/.test(f)),
			// umd/ directory without min
			files.find((f) => /umd\/.*\.js$/.test(f) && !isEsm(f)),
			// dist/*.global.prod.js (Vue, etc.)
			files.find((f) => /dist\/.*\.global\.prod\.js$/.test(f) && !isEsm(f)),
			// dist/*.production.min.js (React-like)
			files.find((f) => /dist\/.*\.production\.min\.js$/.test(f) && !isEsm(f)),
			// dist/*.min.js (jQuery, axios, lodash, etc.)
			files.find((f) => /dist\/.*\.min\.js$/.test(f) && !isEsm(f)),
			// root-level *.min.js (lodash, moment)
			files.find((f) => /^[^/]+\.min\.js$/.test(f) && !isEsm(f)),
		].filter(Boolean) as string[];

		if (!candidates.length) return { pkg, version, umdUrl: null, globalName: null };

		const umdUrl = `https://cdn.jsdelivr.net/npm/${pkg}@${version}/${candidates[0]}`;
		return { pkg, version, umdUrl, globalName: guessGlobal(pkg) };
	} catch {
		return { pkg, version, umdUrl: null, globalName: null };
	}
}

// ─── UMD loader (per unique package) ─────────────────────────────────────────

function UmdScriptTags(props: { entries: MeasurementEntry[] }) {
	const uniquePkgs = () => {
		const seen = new Set<string>();
		return props.entries.filter((e) => {
			const k = `${e.pkg}@${e.version}`;
			if (seen.has(k)) return false;
			seen.add(k);
			return true;
		});
	};

	const [umdData] = createResource(
		() => uniquePkgs().map((e) => `${e.pkg}@${e.version}`).join(','),
		async () => {
			const pkgs = uniquePkgs();
			return Promise.all(pkgs.map((e) => fetchUmdInfo(e.pkg, e.version)));
		},
	);

	const scriptTagLines = () => {
		const data = umdData();
		if (!data) return '';
		return data
			.map((info) => {
				if (!info.umdUrl) return `<!-- ⚠ ${info.pkg} has no UMD build — script tag externalization is not possible -->`;
				return `<script src="${info.umdUrl}"><\/script>`;
			})
			.join('\n');
	};

	return (
		<Show when={!umdData.loading} fallback={<p class={styles.loading}>Checking for UMD builds…</p>}>
			<pre class={`${styles.code} lang-html`}>{scriptTagLines()}</pre>
			<Show when={(umdData() ?? []).some((d) => !d.umdUrl)}>
				<ul class={styles.warnings}>
					<For each={(umdData() ?? []).filter((d) => !d.umdUrl)}>
						{(d) => (
							<li>
								<strong>{d.pkg}</strong> has no UMD build — script tag externalization is not
								possible.
							</li>
						)}
					</For>
				</ul>
			</Show>
		</Show>
	);
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton(props: { text: string }) {
	const [copied, setCopied] = createSignal(false);
	const copy = () => {
		navigator.clipboard.writeText(props.text).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	};
	return (
		<button class={styles.copyBtn} onClick={copy}>
			{copied() ? 'copied' : 'copy'}
		</button>
	);
}

// ─── Main component ───────────────────────────────────────────────────────────

export function OutputTabs(props: OutputTabsProps) {
	const [tab, setTab] = createSignal<TabId>('importmap');

	const importmapText = () => buildImportmap(props.entries, props.resources, props.cdn);
	const importsText = () => buildEsmImports(props.entries, props.resources, props.cdn);

	const tabs: { id: TabId; label: string }[] = [
		{ id: 'importmap', label: 'importmap' },
		{ id: 'imports', label: 'import URLs' },
		{ id: 'scripttags', label: 'script tags' },
	];

	return (
		<div class={styles.outputTabs}>
			<div class={styles.tabBar}>
				<For each={tabs}>
					{(t) => (
						<button
							class={`${styles.tabBtn} ${tab() === t.id ? styles.active : ''}`}
							onClick={() => setTab(t.id)}
						>
							{t.label}
						</button>
					)}
				</For>
			</div>

			<div class={styles.tabPanel}>
				<Show when={tab() === 'importmap'}>
					<div class={styles.codeWrap}>
						<CopyButton text={importmapText()} />
						<pre class={`${styles.code} lang-json`}>{importmapText()}</pre>
					</div>
				</Show>

				<Show when={tab() === 'imports'}>
					<div class={styles.codeWrap}>
						<CopyButton text={importsText()} />
						<pre class={`${styles.code} lang-ts`}>{importsText()}</pre>
					</div>
				</Show>

				<Show when={tab() === 'scripttags'}>
					<UmdScriptTags entries={props.entries} />
				</Show>
			</div>
		</div>
	);
}
