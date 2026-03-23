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

// ─── palette ─────────────────────────────────────────────────────────────────

const C = {
	bg:       '#0d1117', // GitHub dark bg
	panel:    '#161b22', // slightly lighter
	border:   '#30363d',
	label:    '#8b949e', // muted text
	value:    '#e6edf3', // primary text
	accent:   '#58a6ff', // blue accent
	green:    '#3fb950',
	yellow:   '#d29922',
	red:      '#f85149',
	pill_bg:  '#21262d',
};

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── 1. COMPACT BADGE ────────────────────────────────────────────────────────
// Classic two-pill shield: "bulk | 170 B · esm.sh"
// Use: ![](https://bulk.frustrated.dev/jsdelivr/zustand)

export function generateBadgeSvg(label: string, value: string, isError: boolean): string {
	const lw = tw(label) + 18;
	const vw = tw(value) + 18;
	const W = lw + vw;
	const lx = lw / 2;
	const vx = lw + vw / 2;
	const vc = isError ? C.red : C.green;

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="${esc(label)}: ${esc(value)}">
  <title>${esc(label)}: ${esc(value)}</title>
  <defs>
    <linearGradient id="g" x2="0" y2="100%">
      <stop offset="0" stop-color="#fff" stop-opacity=".07"/>
      <stop offset="1" stop-opacity=".07"/>
    </linearGradient>
    <clipPath id="c"><rect width="${W}" height="${H}" rx="${R}" fill="#fff"/></clipPath>
  </defs>
  <g clip-path="url(#c)">
    <rect width="${lw}" height="${H}" fill="#555"/>
    <rect x="${lw}" width="${vw}" height="${H}" fill="${vc}"/>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
  </g>
  <g text-anchor="middle" font-family="${FONT}" font-size="11" fill="#fff">
    <text x="${lx}" y="14" fill="#000" fill-opacity=".25" aria-hidden="true">${esc(label)}</text>
    <text x="${lx}" y="13">${esc(label)}</text>
    <text x="${vx}" y="14" fill="#000" fill-opacity=".25" aria-hidden="true">${esc(value)}</text>
    <text x="${vx}" y="13">${esc(value)}</text>
  </g>
</svg>`.trim();
}

// ─── 2. STANDARD INFO BANNER ─────────────────────────────────────────────────
// One-row dark banner: package@version · CDN · size · N exports · ESM/UMD pills
// Width: 520px  Height: 28px
// Use: ![](https://bulk.frustrated.dev/banner/zustand)

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
}

export function generateStandardBanner(d: BannerData): string {
	const W = 520;
	const H = BANNER_H;
	const PAD = 10;

	const sizeStr  = d.isError  ? (d.errorMsg ?? 'error')
	               : d.bytes === null ? 'measuring…'
	               : formatSize(d.bytes);
	const sizeCol  = d.isError  ? C.red
	               : d.bytes === null ? C.label
	               : C.green;

	// Left section: "pkg@version"
	const pkgLabel = `${esc(d.pkg)}@${esc(d.version)}`;
	// Pills on the right
	const pills: Array<{ text: string; color: string }> = [
		{ text: d.cdn,  color: C.accent },
		...(d.hasEsm ? [{ text: 'ESM', color: C.green }] : []),
		...(d.hasUmd ? [{ text: 'UMD', color: C.yellow }] : [{ text: 'no UMD', color: C.red }]),
	];

	// Build pill rects from right edge
	let pillX = W - PAD;
	const pillEls: string[] = [];
	for (const p of [...pills].reverse()) {
		const pw = tw(p.text) + 12;
		pillX -= pw + 4;
		pillEls.unshift(`
    <rect x="${pillX}" y="6" width="${pw}" height="16" rx="3" fill="${p.color}" fill-opacity=".18" stroke="${p.color}" stroke-width=".5"/>
    <text x="${pillX + pw / 2}" y="18" text-anchor="middle" font-size="10" fill="${p.color}" font-family="${FONT}">${esc(p.text)}</text>`);
	}
	const pillsEndX = pillX - 8;

	// Center stats
	const exportsLabel = `${d.exportCount} export${d.exportCount !== 1 ? 's' : ''}`;
	const statsX = (PAD + 12 + tw(pkgLabel) + 24 + tw(sizeStr)) / 2 + PAD;

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="${esc(d.pkg)} ${sizeStr}">
  <title>${esc(d.pkg)}@${esc(d.version)} · ${esc(d.cdn)} · ${esc(sizeStr)}</title>
  <rect width="${W}" height="${H}" rx="${R}" fill="${C.bg}"/>
  <rect width="${W}" height="${H}" rx="${R}" fill="none" stroke="${C.border}" stroke-width="1"/>
  <!-- pkg@version -->
  <text x="${PAD}" y="18" font-family="${FONT}" font-size="11" fill="${C.value}" font-weight="bold">${pkgLabel}</text>
  <!-- separator -->
  <text x="${PAD + tw(pkgLabel) + 10}" y="18" font-family="${FONT}" font-size="11" fill="${C.border}">·</text>
  <!-- size -->
  <text x="${PAD + tw(pkgLabel) + 22}" y="18" font-family="${FONT}" font-size="11" fill="${sizeCol}">${esc(sizeStr)}</text>
  <!-- separator -->
  <text x="${PAD + tw(pkgLabel) + 22 + tw(sizeStr) + 10}" y="18" font-family="${FONT}" font-size="11" fill="${C.border}">·</text>
  <!-- exports count -->
  <text x="${PAD + tw(pkgLabel) + 22 + tw(sizeStr) + 22}" y="18" font-family="${FONT}" font-size="11" fill="${C.label}">${esc(exportsLabel)}</text>
  <!-- pills -->
  ${pillEls.join('')}
</svg>`.trim();
}

// ─── 3. FULL DETAIL BANNER ───────────────────────────────────────────────────
// Multi-row dark banner: header row + one row per export
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

	// CDN — derive from first export (all same CDN in practice)
	const cdn = d.exports[0]?.cdn ?? '';

	const rows = d.exports.map((e, i) => {
		const y      = HEAD_H + i * ROW_H;
		const isLast = i === d.exports.length - 1;
		const keyStr = e.key === '.' ? `${d.pkg}` : `${d.pkg}/${e.key}`;
		const sizeStr = e.isError ? 'error' : e.bytes === null ? '…' : formatSize(e.bytes);
		const sizeCol = e.isError ? C.red : e.bytes === null ? C.label : C.green;

		// Simple bar proportional to bytes relative to max
		const maxBytes = Math.max(1, ...d.exports.map(ex => ex.bytes ?? 0));
		const barW = e.bytes === null ? 0 : Math.round(((e.bytes / maxBytes) * (W * 0.25)));

		return `
  <!-- row ${i} -->
  <rect x="0" y="${y}" width="${W}" height="${ROW_H}" fill="${i % 2 === 0 ? C.panel : C.bg}"/>
  ${!isLast ? `<line x1="0" y1="${y + ROW_H}" x2="${W}" y2="${y + ROW_H}" stroke="${C.border}" stroke-width=".5"/>` : ''}
  <!-- bar -->
  <rect x="${PAD}" y="${y + 7}" width="${barW}" height="8" rx="2" fill="${C.accent}" fill-opacity=".25"/>
  <!-- key -->
  <text x="${PAD}" y="${y + 15}" font-family="${FONT}" font-size="10.5" fill="${C.value}">${esc(keyStr)}</text>
  <!-- size -->
  <text x="${W - PAD}" y="${y + 15}" text-anchor="end" font-family="${FONT}" font-size="10.5" fill="${sizeCol}" font-weight="bold">${esc(sizeStr)}</text>`;
	});

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="${esc(d.pkg)} bundle sizes">
  <title>${esc(d.pkg)}@${esc(d.version)} · ${esc(cdn)} · ${esc(totalStr)} total</title>
  <!-- outer card -->
  <rect width="${W}" height="${H}" rx="${R}" fill="${C.bg}"/>
  <rect width="${W}" height="${H}" rx="${R}" fill="none" stroke="${C.border}" stroke-width="1"/>
  <!-- header -->
  <rect width="${W}" height="${HEAD_H}" rx="${R}" fill="${C.panel}"/>
  <rect y="${HEAD_H - R}" width="${W}" height="${R}" fill="${C.panel}"/>
  <line x1="0" y1="${HEAD_H}" x2="${W}" y2="${HEAD_H}" stroke="${C.border}" stroke-width=".5"/>
  <!-- header: left — pkg@version -->
  <text x="${PAD}" y="19" font-family="${FONT}" font-size="12" fill="${C.value}" font-weight="bold">${esc(d.pkg)}<tspan fill="${C.label}" font-weight="normal">@${esc(d.version)}</tspan></text>
  <!-- header: right — total + cdn pill -->
  <text x="${W - PAD - tw(cdn) - 16}" y="19" text-anchor="end" font-family="${FONT}" font-size="12" fill="${C.green}" font-weight="bold">${esc(totalStr)}</text>
  <rect x="${W - PAD - tw(cdn) - 12}" y="7" width="${tw(cdn) + 12}" height="15" rx="3" fill="${C.accent}" fill-opacity=".15" stroke="${C.accent}" stroke-width=".5"/>
  <text x="${W - PAD - tw(cdn) / 2 - 6}" y="19" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${C.accent}">${esc(cdn)}</text>
  ${rows.join('')}
  <!-- bottom corners -->
  <rect x="0" y="${H - R}" width="${W}" height="${R}" rx="0" fill="${C.bg}"/>
  <rect x="0" y="${H - R}" width="${R}" height="${R}" fill="${C.bg}"/>
  <rect x="${W - R}" y="${H - R}" width="${R}" height="${R}" fill="${C.bg}"/>
</svg>`.trim();
}

// ─── helpers ─────────────────────────────────────────────────────────────────

export function formatSize(bytes: number): string {
	if (bytes === 0) return '0 B';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
