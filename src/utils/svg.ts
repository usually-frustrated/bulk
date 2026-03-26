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
// Wide two-pill shield showing size + optional browser timing stats.
//
//   established    → green pill
//   tentative      → yellow pill,  value + asterisk
//   server-estimate→ yellow pill,  tilde-prefixed value
//   no-data        → dark pill,    "measure →" CTA
//
// Right pill text: "11.4 kB  ·  5 exports  ·  1 file  ·  1 round trip  ·  111 ms"
//
// Use: ![](https://bulk.frustrated.dev/jsdelivr/zustand)

export interface BadgeStats {
	pkgName?:     string;
	version?:     string;
	esm?:         boolean;
	exportCount?: number;
	fileCount?:   number;
	roundTrips?:  number;
	durationMs?:  number;
}

export function generateBadgeSvg(
	label: string,
	value: string,
	confidence: Confidence,
	stats?: BadgeStats,
): string {
	let baseValue: string;
	let vc: string;

	switch (confidence) {
		case 'established':    baseValue = value;           vc = C.green;    break;
		case 'tentative':      baseValue = `${value} *`;   vc = C.yellow;   break;
		case 'server-estimate':baseValue = `~${value}`;    vc = C.yellow;   break;
		case 'no-data':        baseValue = 'measure \u2192'; vc = C.pill_bg; break;
	}

	// Build right-side text from stats parts
	const pkgId = stats?.pkgName
		? stats.version ? `${stats.pkgName}@${stats.version}` : stats.pkgName
		: null;
	const parts: string[] = [];
	if (pkgId)                       parts.push(pkgId);
	parts.push(baseValue);
	if (stats?.exportCount != null) parts.push(`${stats.exportCount} export${stats.exportCount !== 1 ? 's' : ''}`);
	if (stats?.fileCount   != null) parts.push(`${stats.fileCount} file${stats.fileCount !== 1 ? 's' : ''}`);
	if (stats?.roundTrips  != null) parts.push(`${stats.roundTrips} round trip${stats.roundTrips !== 1 ? 's' : ''}`);
	if (stats?.durationMs  != null) parts.push(`${Math.round(stats.durationMs)} ms`);
	if (stats?.esm)                  parts.push('ESM');
	const displayValue = parts.join('  \u00b7  ');

	const lw = tw(label) + 18;
	const vw = tw(displayValue) + 18;
	const W  = lw + vw;
	const lx = lw / 2;
	const vx = lw + vw / 2;
	const vtextFill = confidence === 'no-data' ? C.accent : '#fff';

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="${esc(label)}: ${esc(displayValue)}">
  <title>${esc(label)}: ${esc(displayValue)}</title>
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
  <g text-anchor="middle" font-family="${FONT}" font-size="11">
    <text x="${lx}" y="14" fill="#000" fill-opacity=".25" aria-hidden="true">${esc(label)}</text>
    <text x="${lx}" y="13" fill="#fff">${esc(label)}</text>
    <text x="${vx}" y="14" fill="#000" fill-opacity=".25" aria-hidden="true">${esc(displayValue)}</text>
    <text x="${vx}" y="13" fill="${vtextFill}">${esc(displayValue)}</text>
  </g>
</svg>`.trim();
}

// ─── 2. STANDARD INFO BANNER ─────────────────────────────────────────────────
// Two-row dark banner with waterfall-style stats
// Width: 520px  Height: 64px
// Use: ![](https://bulk.frustrated.dev/_banner/standard/zustand)

export interface BannerResource {
	url:          string;
	startTime:    number;
	responseEnd:  number;
	transferSize: number | null;
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
	durationMs?: number;
	// per-resource timings for waterfall rendering
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
	              : d.bytes === null  ? 'measuring…'
	              : formatSize(d.bytes);
	const sizeCol = d.isError        ? C.red
	              : d.bytes === null  ? C.label
	              : C.green;

	// ── header pills (CDN, ESM, UMD) ────────────────────────────────────────
	const pills: Array<{ text: string; color: string }> = [
		{ text: d.cdn, color: C.accent },
		...(d.hasEsm ? [{ text: 'ESM', color: C.green }] : []),
		...(d.hasUmd ? [{ text: 'UMD', color: C.yellow }] : [{ text: 'no UMD', color: C.red }]),
	];
	let pillX = W - PAD;
	const pillEls: string[] = [];
	for (const p of [...pills].reverse()) {
		const pw = tw(p.text) + 12;
		pillX -= pw + 4;
		pillEls.unshift(`
  <rect x="${pillX}" y="6" width="${pw}" height="16" rx="3" fill="${p.color}" fill-opacity=".18" stroke="${p.color}" stroke-width=".5"/>
  <text x="${pillX + pw / 2}" y="18" text-anchor="middle" font-size="10" fill="${p.color}" font-family="${FONT}">${esc(p.text)}</text>`);
	}

	const pkgLabel = esc(d.pkg);
	const verLabel = `@${esc(d.version)}`;

	// ── stat items (shared by both layout paths) ─────────────────────────────
	const exportsLabel  = `${d.exportCount} export${d.exportCount !== 1 ? 's' : ''}`;
	const filesLabel    = d.fileCount  != null ? `${d.fileCount} file${d.fileCount !== 1 ? 's' : ''}` : null;
	const tripsLabel    = d.roundTrips != null ? `${d.roundTrips} round trip${d.roundTrips !== 1 ? 's' : ''}` : null;
	const durationLabel = d.durationMs != null ? `${d.durationMs.toFixed(0)} ms` : null;

	const statItems: Array<{ label: string; color: string }> = [
		{ label: sizeStr, color: sizeCol },
		{ label: exportsLabel, color: C.label },
		...(filesLabel    ? [{ label: filesLabel,    color: C.label }] : []),
		...(tripsLabel    ? [{ label: tripsLabel,    color: C.label }] : []),
		...(durationLabel ? [{ label: durationLabel, color: C.label }] : []),
	];

	function renderStatLine(y: number): string {
		let x = PAD;
		const els: string[] = [];
		for (let i = 0; i < statItems.length; i++) {
			const s = statItems[i];
			els.push(`<text x="${x}" y="${y}" font-family="${FONT}" font-size="10" fill="${s.color}">${esc(s.label)}</text>`);
			x += tw(s.label) + 6;
			if (i < statItems.length - 1) {
				els.push(`<text x="${x}" y="${y}" font-family="${FONT}" font-size="10" fill="${C.border}">·</text>`);
				x += tw('·') + 6;
			}
		}
		return els.join('\n  ');
	}

	const svgHeader = (H: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="${esc(d.pkg)} ${sizeStr}">
  <title>${esc(d.pkg)}@${esc(d.version)} · ${esc(d.cdn)} · ${esc(sizeStr)}</title>
  <!-- card background -->
  <rect width="${W}" height="${H}" rx="${R}" fill="${C.bg}"/>
  <rect width="${W}" height="${H}" rx="${R}" fill="none" stroke="${C.border}" stroke-width="1"/>
  <!-- header band -->
  <rect width="${W}" height="${H1}" rx="${R}" fill="${C.panel}"/>
  <rect y="${H1 - R}" width="${W}" height="${R}" fill="${C.panel}"/>
  <line x1="0" y1="${H1}" x2="${W}" y2="${H1}" stroke="${C.border}" stroke-width=".5"/>
  <!-- pkg name + version -->
  <text x="${PAD}" y="19" font-family="${FONT}" font-size="12" fill="${C.value}" font-weight="bold">${pkgLabel}<tspan fill="${C.label}" font-weight="normal">${verLabel}</tspan></text>
  <!-- pills -->
  ${pillEls.join('')}`;

	// ── Waterfall layout (when per-resource timing data is available) ─────────
	const resources = d.resources && d.resources.length > 0 ? d.resources : null;
	if (resources) {
		const STATS_H  = 18; // stats text row height
		const ROW_H    = 13; // height for both round headers and resource rows

		const sorted = [...resources].sort((a, b) => a.startTime - b.startTime);
		const t0     = sorted[0].startTime;
		const tMax   = Math.max(...sorted.map((r) => r.responseEnd));
		const span   = Math.max(1, tMax - t0);

		// Group into rounds (gap > 5 ms = new round)
		interface SvgRound { idx: number; offset: number; items: typeof sorted }
		const rounds: SvgRound[] = [];
		let cur: typeof sorted = [sorted[0]];
		for (let i = 1; i < sorted.length; i++) {
			if (sorted[i].startTime - sorted[i - 1].startTime > 5) {
				rounds.push({ idx: rounds.length, offset: cur[0].startTime - t0, items: cur });
				cur = [];
			}
			cur.push(sorted[i]);
		}
		rounds.push({ idx: rounds.length, offset: cur[0].startTime - t0, items: cur });

		const totalRows = rounds.reduce((s, rd) => s + 1 + rd.items.length, 0);
		const H = H1 + STATS_H + totalRows * ROW_H + 5;

		// Layout: label + size col | bar track
		const LABEL_W = 130;
		const SIZE_W  = 50;
		const BAR_X   = PAD + LABEL_W + SIZE_W;
		const BAR_W   = W - BAR_X - PAD;

		const roundColors = [C.accent, C.green, C.yellow, C.red];

		const rowEls: string[] = [];
		let ry = H1 + STATS_H;

		for (const round of rounds) {
			const rc = roundColors[Math.min(round.idx, roundColors.length - 1)];
			const roundLabel  = `ROUND ${round.idx + 1}`;
			const offsetLabel = `+${round.offset.toFixed(0)}\u202fms`;
			// Use tw() (11px Verdana) scaled to 9px
			const tw9 = (s: string) => Math.ceil(s.length * 5.3);
			rowEls.push(
				`<text x="${PAD}" y="${ry + ROW_H - 3}" font-family="${FONT}" font-size="9" fill="${rc}" letter-spacing=".05em">${esc(roundLabel)}</text>` +
				`<text x="${PAD + tw9(roundLabel) + 6}" y="${ry + ROW_H - 3}" font-family="${FONT}" font-size="9" fill="${C.label}">${esc(offsetLabel)}</text>`,
			);
			ry += ROW_H;

			for (let ri = 0; ri < round.items.length; ri++) {
				const r    = round.items[ri];
				const barL = ((r.startTime - t0) / span) * BAR_W;
				const barW = Math.max(3, ((r.responseEnd - r.startTime) / span) * BAR_W);
				const name = waterfallFilename(r.url, 18);
				const size = r.transferSize != null ? formatSize(r.transferSize) : '\u2013';
				const rowBg = ri % 2 === 1
					? `<rect x="0" y="${ry}" width="${W}" height="${ROW_H}" fill="${C.panel}" fill-opacity=".5"/>`
					: '';
				rowEls.push(
					rowBg +
					`<text x="${PAD}" y="${ry + ROW_H - 3}" font-family="${FONT}" font-size="9.5" fill="${C.value}">${esc(name)}</text>` +
					`<text x="${BAR_X - 4}" y="${ry + ROW_H - 3}" text-anchor="end" font-family="${FONT}" font-size="9.5" fill="${C.label}">${esc(size)}</text>` +
					`<rect x="${(BAR_X + barL).toFixed(1)}" y="${ry + 2}" width="${barW.toFixed(1)}" height="${ROW_H - 4}" rx="1.5" fill="${rc}" fill-opacity=".8"/>`,
				);
				ry += ROW_H;
			}
		}

		return `${svgHeader(H)}
  <!-- stats line -->
  ${renderStatLine(H1 + 13)}
  <line x1="0" y1="${H1 + STATS_H}" x2="${W}" y2="${H1 + STATS_H}" stroke="${C.border}" stroke-width=".5"/>
  <!-- label / bar divider -->
  <line x1="${BAR_X}" y1="${H1 + STATS_H}" x2="${BAR_X}" y2="${H}" stroke="${C.border}" stroke-width=".5" stroke-opacity=".4"/>
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
  <rect x="${PAD}" y="${barY}" width="${barMaxW}" height="4" rx="2" fill="${C.border}" fill-opacity=".4"/>
  <rect x="${PAD}" y="${barY}" width="${barW}" height="4" rx="2" fill="${sizeCol}" fill-opacity=".7"/>
  <!-- stats row: text metrics -->
  ${renderStatLine(H1 + 28)}
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
