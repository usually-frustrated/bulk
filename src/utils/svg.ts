import type { Confidence } from './cdn';

// ─── shared constants ─────────────────────────────────────────────────────────

const FONT = "Verdana,Geneva,DejaVu Sans,sans-serif";
const H = 20; // compact badge height
const BANNER_H = 28; // standard / full banner row height
const R = 4; // corner radius

// Accurate Verdana character width at 11px
const CHAR_W = 6.5;
function tw(s: string) {
	return Math.ceil(s.length * CHAR_W);
}

// ─── palette ──────────────────────────────────────────────────────────────────
// Dark is the default; light palette activates via prefers-color-scheme.
// Accent colours use darker shades in light mode for WCAG contrast.

const D = { // dark
	bg:     '#0d1117',
	panel:  '#161b22',
	border: '#30363d',
	label:  '#8b949e',
	value:  '#e6edf3',
	acc:    '#58a6ff',
	grn:    '#3fb950',
	yel:    '#d29922',
	red:    '#f85149',
};
const L = { // light
	bg:     '#ffffff',
	panel:  '#f6f8fa',
	border: '#d0d7de',
	label:  '#57606a',
	value:  '#24292f',
	acc:    '#0969da',
	grn:    '#1a7f37',
	yel:    '#9a6700',
	red:    '#cf222e',
};

// ─── theme CSS ────────────────────────────────────────────────────────────────
// f-* classes set fill; s-* classes set stroke.
// All SVG elements use these classes instead of inline fill/stroke attributes
// so a single media-query block switches the full palette.

const THEME_CSS = `
  .f-bg    { fill: ${D.bg} }
  .f-panel { fill: ${D.panel} }
  .f-lbl   { fill: ${D.label} }
  .f-val   { fill: ${D.value} }
  .f-bd    { fill: ${D.border} }
  .f-acc   { fill: ${D.acc} }
  .f-grn   { fill: ${D.grn} }
  .f-yel   { fill: ${D.yel} }
  .f-red   { fill: ${D.red} }
  .s-bd    { stroke: ${D.border} }
  .s-acc   { stroke: ${D.acc} }
  .s-grn   { stroke: ${D.grn} }
  .s-yel   { stroke: ${D.yel} }
  .s-red   { stroke: ${D.red} }
  /* Badge value-pill: solid colour in dark, panel bg in light (see light overrides) */
  .vc-grn  { fill: ${D.grn} }
  .vc-yel  { fill: ${D.yel} }
  /* Badge value-text: white in dark, confidence-colour in light */
  .vt-grn  { fill: #fff }
  .vt-yel  { fill: #fff }
  @media (prefers-color-scheme: light) {
    .f-bg    { fill: ${L.bg} }
    .f-panel { fill: ${L.panel} }
    .f-lbl   { fill: ${L.label} }
    .f-val   { fill: ${L.value} }
    .f-bd    { fill: ${L.border} }
    .f-acc   { fill: ${L.acc} }
    .f-grn   { fill: ${L.grn} }
    .f-yel   { fill: ${L.yel} }
    .f-red   { fill: ${L.red} }
    .s-bd    { stroke: ${L.border} }
    .s-acc   { stroke: ${L.acc} }
    .s-grn   { stroke: ${L.grn} }
    .s-yel   { stroke: ${L.yel} }
    .s-red   { stroke: ${L.red} }
    /* Badge value section: panel bg + confidence-coloured text in light mode */
    .vc-grn  { fill: ${L.panel} }
    .vc-yel  { fill: ${L.panel} }
    .vt-grn  { fill: ${L.grn} }
    .vt-yel  { fill: ${L.yel} }
  }`.trim();

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── 1. COMPACT BADGE ────────────────────────────────────────────────────────
// Wide two-pill shield showing size + optional browser timing stats.
//
//   established    → green right pill
//   tentative      → yellow right pill, value + asterisk
//   server-estimate→ yellow right pill, tilde-prefixed value
//   no-data        → panel-colour right pill, "measure →" CTA in accent
//
// Use: ![](https://bulk.frustrated.dev/jsdelivr/zustand)

export interface BadgeStats {
	pkgName?:     string;
	version?:     string;
	format?:      string; // e.g. 'ESM', 'UMD', 'CJS', 'IIFE'
	exportCount?: number;
	fileCount?:   number;
	roundTrips?:  number;
}

export function generateBadgeSvg(
	label: string,
	value: string,
	confidence: Confidence,
	stats?: BadgeStats,
): string {
	let baseValue: string;
	// vcCls: right-section background (solid colour dark → panel light)
	// vtAttr: value text attribute (white dark → confidence colour light)
	let vcCls: string;
	let vtAttr: string;

	switch (confidence) {
		case 'established':
			baseValue = value;
			vcCls = 'vc-grn'; vtAttr = 'class="vt-grn"';
			break;
		case 'tentative':
			baseValue = `${value} *`;
			vcCls = 'vc-yel'; vtAttr = 'class="vt-yel"';
			break;
		case 'server-estimate':
			baseValue = `~${value}`;
			vcCls = 'vc-yel'; vtAttr = 'class="vt-yel"';
			break;
		case 'no-data':
			// No-data: panel bg (themed), accent-blue CTA text (themed)
			baseValue = 'measure \u2192';
			vcCls = 'f-panel'; vtAttr = 'class="f-acc"';
			break;
	}

	const pkgId = stats?.pkgName
		? stats.version ? `${stats.pkgName}@${stats.version}` : stats.pkgName
		: null;
	const parts: string[] = [];
	if (pkgId)                       parts.push(pkgId);
	parts.push(baseValue);
	if (stats?.exportCount != null) parts.push(`${stats.exportCount} export${stats.exportCount !== 1 ? 's' : ''}`);
	if (stats?.fileCount   != null) parts.push(`${stats.fileCount} file${stats.fileCount !== 1 ? 's' : ''}`);
	if (stats?.roundTrips  != null) parts.push(`${stats.roundTrips} round trip${stats.roundTrips !== 1 ? 's' : ''}`);
	if (stats?.format)               parts.push(stats.format);
	const displayValue = parts.join('  \u00b7  ');

	const lw = tw(label) + 18;
	const vw = tw(displayValue) + 18;
	const W  = lw + vw;
	const lx = lw / 2;
	const vx = lw + vw / 2;
	// vtAttr is set above per confidence case
	// Width-scoped clipPath ID avoids conflicts when multiple badges share a page
	const uid = `bg${W}`;

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="${esc(label)}: ${esc(displayValue)}">
  <title>${esc(label)}: ${esc(displayValue)}</title>
  <style>${THEME_CSS}</style>
  <defs>
    <clipPath id="${uid}c"><rect width="${W}" height="${H}" rx="${R}" fill="#fff"/></clipPath>
  </defs>
  <g clip-path="url(#${uid}c)">
    <rect width="${W}" height="${H}" class="f-panel"/>
    <rect x="${lw}" width="${vw}" height="${H}" class="${vcCls}"/>
  </g>
  <rect width="${W}" height="${H}" rx="${R}" fill="none" class="s-bd" stroke-width=".8"/>
  <g text-anchor="middle" font-family="${FONT}" font-size="11">
    <text x="${lx}" y="14" class="f-lbl">${esc(label)}</text>
    <text x="${vx}" y="14" ${vtAttr}>${esc(displayValue)}</text>
  </g>
</svg>`.trim();
}

// ─── 2. STANDARD INFO BANNER ─────────────────────────────────────────────────
// Two-row dark banner with waterfall-style stats
// Width: 520px  Height: 64px (fallback) or dynamic (waterfall)
// Use: ![](https://bulk.frustrated.dev/_banner/standard/zustand)

export interface BannerResource {
	url:       string;
	roundTrip: number; // 0-indexed dependency depth (pre-computed at ingestion)
	bytes:     number | null; // decoded_body_size (uncompressed)
}

export interface BannerData {
	pkg:         string;
	version:     string;
	cdn:         string;
	bytes:       number | null;
	exportCount: number;
	hasEsm:      boolean;
	hasUmd:      boolean;
	isError:     boolean;
	errorMsg?:   string;
	// optional waterfall stats
	fileCount?:  number;
	roundTrips?: number;
	// per-resource waterfall entries for rendering
	resources?:  BannerResource[];
}

// Truncate a resource URL to a short filename for waterfall row labels.
function waterfallFilename(url: string, maxLen = 22): string {
	try {
		const u = new URL(url);
		const parts = u.pathname.split('/').filter(Boolean);
		const name = parts[parts.length - 1] || u.hostname;
		return name.length > maxLen ? name.slice(0, maxLen - 1) + '…' : name;
	} catch {
		return url.slice(0, maxLen);
	}
}

export function generateStandardBanner(d: BannerData): string {
	const W   = 520;
	const H1  = BANNER_H; // header row = 28px
	const PAD = 10;

	const sizeStr = d.isError        ? (d.errorMsg ?? 'error')
	              : d.bytes === null  ? '—'
	              : formatSize(d.bytes);
	const sizeCls = d.isError        ? 'f-red'
	              : d.bytes === null  ? 'f-lbl'
	              : 'f-grn';

	// ── header pills (CDN, ESM, UMD) ────────────────────────────────────────
	const pills: Array<{ text: string; key: 'acc' | 'grn' | 'yel' | 'red' }> = [
		{ text: d.cdn, key: 'acc' },
		...(d.hasEsm ? [{ text: 'ESM', key: 'grn' as const }] : []),
		...(d.hasUmd ? [{ text: 'UMD', key: 'yel' as const }] : [{ text: 'no UMD', key: 'red' as const }]),
	];
	let pillX = W - PAD;
	const pillEls: string[] = [];
	for (const p of [...pills].reverse()) {
		const pw = tw(p.text) + 12;
		pillX -= pw + 4;
		pillEls.unshift(`
  <rect x="${pillX}" y="6" width="${pw}" height="16" rx="3" class="f-${p.key} s-${p.key}" fill-opacity=".18" stroke-width=".5"/>
  <text x="${pillX + pw / 2}" y="18" text-anchor="middle" font-size="10" class="f-${p.key}" font-family="${FONT}">${esc(p.text)}</text>`);
	}

	const pkgLabel = esc(d.pkg);
	const verLabel = `@${esc(d.version)}`;

	// ── stat items (shared by both layout paths) ─────────────────────────────
	const exportsLabel = `${d.exportCount} export${d.exportCount !== 1 ? 's' : ''}`;
	const filesLabel   = d.fileCount  != null ? `${d.fileCount} file${d.fileCount !== 1 ? 's' : ''}` : null;
	const tripsLabel   = d.roundTrips != null ? `${d.roundTrips} round trip${d.roundTrips !== 1 ? 's' : ''}` : null;

	const statItems: Array<{ label: string; cls: string }> = [
		{ label: sizeStr,      cls: sizeCls },
		{ label: exportsLabel, cls: 'f-lbl' },
		...(filesLabel ? [{ label: filesLabel, cls: 'f-lbl' }] : []),
		...(tripsLabel ? [{ label: tripsLabel, cls: 'f-lbl' }] : []),
	];

	function renderStatLine(y: number): string {
		let x = PAD;
		const els: string[] = [];
		for (let i = 0; i < statItems.length; i++) {
			const s = statItems[i];
			els.push(`<text x="${x}" y="${y}" font-family="${FONT}" font-size="10" class="${s.cls}">${esc(s.label)}</text>`);
			x += tw(s.label) + 6;
			if (i < statItems.length - 1) {
				els.push(`<text x="${x}" y="${y}" font-family="${FONT}" font-size="10" class="f-bd">·</text>`);
				x += tw('·') + 6;
			}
		}
		return els.join('\n  ');
	}

	const svgHeader = (H: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="${esc(d.pkg)} ${sizeStr}">
  <title>${esc(d.pkg)}@${esc(d.version)} · ${esc(d.cdn)} · ${esc(sizeStr)}</title>
  <style>${THEME_CSS}</style>
  <!-- card background -->
  <rect width="${W}" height="${H}" rx="${R}" class="f-bg"/>
  <rect width="${W}" height="${H}" rx="${R}" fill="none" class="s-bd" stroke-width="1"/>
  <!-- header band -->
  <rect width="${W}" height="${H1}" rx="${R}" class="f-panel"/>
  <rect y="${H1 - R}" width="${W}" height="${R}" class="f-panel"/>
  <line x1="0" y1="${H1}" x2="${W}" y2="${H1}" class="s-bd" stroke-width=".5"/>
  <!-- pkg name + version -->
  <text x="${PAD}" y="19" font-family="${FONT}" font-size="12" class="f-val" font-weight="bold">${pkgLabel}<tspan class="f-lbl" font-weight="normal">${verLabel}</tspan></text>
  <!-- pills -->
  ${pillEls.join('')}`;

	// ── Waterfall layout (when per-resource waterfall data is available) ─────
	const resources = d.resources && d.resources.length > 0 ? d.resources : null;
	if (resources) {
		const STATS_H = 18; // stats text row height
		const ROW_H   = 13; // height for both round headers and resource rows

		// Group by pre-computed roundTrip; sort within each round by bytes DESC
		interface SvgRound { idx: number; items: BannerResource[] }
		const roundMap = new Map<number, BannerResource[]>();
		for (const r of resources) {
			if (!roundMap.has(r.roundTrip)) roundMap.set(r.roundTrip, []);
			roundMap.get(r.roundTrip)!.push(r);
		}
		const rounds: SvgRound[] = [...roundMap.entries()]
			.sort(([a], [b]) => a - b)
			.map(([idx, items]) => ({ idx, items: items.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)) }));

		const maxBytes = Math.max(1, ...resources.map((r) => r.bytes ?? 0));

		const totalRows = rounds.reduce((s, rd) => s + 1 + rd.items.length, 0);
		const H = H1 + STATS_H + totalRows * ROW_H + 5;

		// Layout: label col | size col | bar track
		const LABEL_W = 130;
		const SIZE_W  = 50;
		const BAR_X   = PAD + LABEL_W + SIZE_W;
		const BAR_W   = W - BAR_X - PAD;

		const roundKeys: Array<'acc' | 'grn' | 'yel' | 'red'> = ['acc', 'grn', 'yel', 'red'];

		const rowEls: string[] = [];
		let ry = H1 + STATS_H;

		for (const round of rounds) {
			const rk = roundKeys[Math.min(round.idx, roundKeys.length - 1)];
			const roundLabel = `ROUND ${round.idx + 1}`;
			rowEls.push(
				`<text x="${PAD}" y="${ry + ROW_H - 3}" font-family="${FONT}" font-size="9" class="f-${rk}" letter-spacing=".05em">${esc(roundLabel)}</text>`,
			);
			ry += ROW_H;

			for (let ri = 0; ri < round.items.length; ri++) {
				const r    = round.items[ri];
				const barW = Math.max(3, ((r.bytes ?? 0) / maxBytes) * BAR_W);
				const name = waterfallFilename(r.url, 18);
				const size = r.bytes != null ? formatSize(r.bytes) : '\u2013';
				const rowBg = ri % 2 === 1
					? `<rect x="0" y="${ry}" width="${W}" height="${ROW_H}" class="f-panel" fill-opacity=".5"/>`
					: '';
				rowEls.push(
					rowBg +
					`<text x="${PAD}" y="${ry + ROW_H - 3}" font-family="${FONT}" font-size="9.5" class="f-val">${esc(name)}</text>` +
					`<text x="${BAR_X - 4}" y="${ry + ROW_H - 3}" text-anchor="end" font-family="${FONT}" font-size="9.5" class="f-lbl">${esc(size)}</text>` +
					`<rect x="${BAR_X.toFixed(1)}" y="${ry + 2}" width="${barW.toFixed(1)}" height="${ROW_H - 4}" rx="1.5" class="f-${rk}" fill-opacity=".8"/>`,
				);
				ry += ROW_H;
			}
		}

		return `${svgHeader(H)}
  <!-- stats line -->
  ${renderStatLine(H1 + 13)}
  <line x1="0" y1="${H1 + STATS_H}" x2="${W}" y2="${H1 + STATS_H}" class="s-bd" stroke-width=".5"/>
  <!-- label / bar divider -->
  <line x1="${BAR_X}" y1="${H1 + STATS_H}" x2="${BAR_X}" y2="${H}" class="s-bd" stroke-width=".5" stroke-opacity=".4"/>
  <!-- waterfall rows -->
  ${rowEls.join('\n  ')}
</svg>`.trim();
	}

	// ── Fallback: no resource data → compact bar + stats ─────────────────────
	const H2 = 36;
	const H  = H1 + H2;
	const barMaxW = W - PAD * 2;
	const barW    = d.bytes != null
		? Math.min(barMaxW, Math.round((d.bytes / (500 * 1024)) * barMaxW))
		: 0;
	const barY = H1 + 10;

	return `${svgHeader(H)}
  <!-- stats row: size bar -->
  <rect x="${PAD}" y="${barY}" width="${barMaxW}" height="4" rx="2" class="f-bd" fill-opacity=".4"/>
  <rect x="${PAD}" y="${barY}" width="${barW}" height="4" rx="2" class="${sizeCls}" fill-opacity=".7"/>
  <!-- stats row: text metrics -->
  ${renderStatLine(H1 + 28)}
</svg>`.trim();
}

// ─── 3. FULL DETAIL BANNER ───────────────────────────────────────────────────
// Multi-row banner: header row + one row per export
// Width: 520px  Height: 28 + N*22
// Use: ![](https://bulk.frustrated.dev/banner/zustand?detail=full)

export interface ExportRow {
	key:           string;   // e.g. ".", "middleware", "react"
	cdn:           string;
	bytes:         number | null;
	isError:       boolean;
}

export interface FullBannerData {
	pkg:     string;
	version: string;
	exports: ExportRow[];
}

export function generateFullBanner(d: FullBannerData): string {
	const W       = 520;
	const ROW_H   = 22;
	const HEAD_H  = BANNER_H;
	const PAD     = 10;
	const H       = HEAD_H + d.exports.length * ROW_H + PAD / 2;

	const totalBytes = d.exports.reduce<number | null>((acc, e) => {
		if (acc === null || e.bytes === null) return null;
		return acc + e.bytes;
	}, 0);
	const totalStr = totalBytes === null ? '…' : formatSize(totalBytes);

	const cdn = d.exports[0]?.cdn ?? '';

	const rows = d.exports.map((e, i) => {
		const y      = HEAD_H + i * ROW_H;
		const isLast = i === d.exports.length - 1;
		const keyStr  = e.key === '.' ? `${d.pkg}` : `${d.pkg}/${e.key}`;
		const sizeStr = e.isError ? 'error' : e.bytes === null ? '…' : formatSize(e.bytes);
		const sizeCls = e.isError ? 'f-red' : e.bytes === null ? 'f-lbl' : 'f-grn';

		const maxBytes = Math.max(1, ...d.exports.map(ex => ex.bytes ?? 0));
		const barW = e.bytes === null ? 0 : Math.round(((e.bytes / maxBytes) * (W * 0.25)));

		return `
  <!-- row ${i} -->
  <rect x="0" y="${y}" width="${W}" height="${ROW_H}" class="${i % 2 === 0 ? 'f-panel' : 'f-bg'}"/>
  ${!isLast ? `<line x1="0" y1="${y + ROW_H}" x2="${W}" y2="${y + ROW_H}" class="s-bd" stroke-width=".5"/>` : ''}
  <!-- bar -->
  <rect x="${PAD}" y="${y + 7}" width="${barW}" height="8" rx="2" class="f-acc" fill-opacity=".25"/>
  <!-- key -->
  <text x="${PAD}" y="${y + 15}" font-family="${FONT}" font-size="10.5" class="f-val">${esc(keyStr)}</text>
  <!-- size -->
  <text x="${W - PAD}" y="${y + 15}" text-anchor="end" font-family="${FONT}" font-size="10.5" class="${sizeCls}" font-weight="bold">${esc(sizeStr)}</text>`;
	});

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="${esc(d.pkg)} bundle sizes">
  <title>${esc(d.pkg)}@${esc(d.version)} · ${esc(cdn)} · ${esc(totalStr)} total</title>
  <style>${THEME_CSS}</style>
  <!-- outer card -->
  <rect width="${W}" height="${H}" rx="${R}" class="f-bg"/>
  <rect width="${W}" height="${H}" rx="${R}" fill="none" class="s-bd" stroke-width="1"/>
  <!-- header -->
  <rect width="${W}" height="${HEAD_H}" rx="${R}" class="f-panel"/>
  <rect y="${HEAD_H - R}" width="${W}" height="${R}" class="f-panel"/>
  <line x1="0" y1="${HEAD_H}" x2="${W}" y2="${HEAD_H}" class="s-bd" stroke-width=".5"/>
  <!-- header: left — pkg@version -->
  <text x="${PAD}" y="19" font-family="${FONT}" font-size="12" class="f-val" font-weight="bold">${esc(d.pkg)}<tspan class="f-lbl" font-weight="normal">@${esc(d.version)}</tspan></text>
  <!-- header: right — total + cdn pill -->
  <text x="${W - PAD - tw(cdn) - 16}" y="19" text-anchor="end" font-family="${FONT}" font-size="12" class="f-grn" font-weight="bold">${esc(totalStr)}</text>
  <rect x="${W - PAD - tw(cdn) - 12}" y="7" width="${tw(cdn) + 12}" height="15" rx="3" class="f-acc s-acc" fill-opacity=".15" stroke-width=".5"/>
  <text x="${W - PAD - tw(cdn) / 2 - 6}" y="19" text-anchor="middle" font-family="${FONT}" font-size="10" class="f-acc">${esc(cdn)}</text>
  ${rows.join('')}
  <!-- bottom corners -->
  <rect x="0" y="${H - R}" width="${W}" height="${R}" rx="0" class="f-bg"/>
  <rect x="0" y="${H - R}" width="${R}" height="${R}" class="f-bg"/>
  <rect x="${W - R}" y="${H - R}" width="${R}" height="${R}" class="f-bg"/>
</svg>`.trim();
}

// ─── helpers ─────────────────────────────────────────────────────────────────

export function formatSize(bytes: number): string {
	if (bytes === 0) return '0 B';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
