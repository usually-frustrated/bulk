import { createMemo } from 'solid-js';
import type { ResourceTimingEntry } from '../utils/measurement';
import styles from './WaterfallBanner.module.css';

interface Props {
	resources: ResourceTimingEntry[];
	pkg:       string;
	version:   string;
	cdn:       string;
	format:    string; // 'esm' | 'umd' | 'cjs' | 'iife' | 'systemjs'
}

// ─── Design tokens ────────────────────────────────────────────────────────────
//
// Adaptive colors use CSS class selectors defined in SVG_STYLE.  Each element
// carries a `class="wb-*"` name AND a hardcoded dark-theme fill/stroke attribute
// as a fallback for environments that don't run CSS (e.g. no-style renderers).
//
// Approach: CSS classes override presentation attributes (SVG spec), so the
// class-based @media rule wins when CSS is available; the attribute is the
// fallback.  This makes the SVG self-contained — no external CSS, no var().

const FONT = "'Cascadia Code',monospace";

// Fixed accent palette — same for light + dark
const A = {
	accent:  '#58a6ff',
	green:   '#3fb950',
	yellow:  '#d29922',
	red:     '#f85149',
} as const;

const ROUND_COLORS = [A.accent, A.green, A.yellow, A.red] as const;

const FORMAT_COLOR: Record<string, string> = {
	esm:      A.green,
	umd:      A.yellow,
	cjs:      '#8b949e',
	iife:     '#e3b341',
	systemjs: A.accent,
};

// Adaptive dark → light color map (dark values also used as inline attribute fallbacks)
const D = {
	bg:     '#0d1117',
	panel:  '#161b22',
	border: '#30363d',
	label:  '#8b949e',
	value:  '#e6edf3',
} as const;

const L = {
	bg:     '#ffffff',
	panel:  '#f6f8fa',
	border: '#d0d7de',
	label:  '#57606a',
	value:  '#24292f',
} as const;

// Fully self-contained SVG style — no var(), no external deps.
// Dark is the default; light overrides via @media.
// CSS classes override SVG presentation attributes (fill="...", stroke="..."),
// so these rules win when CSS runs; the attributes are the no-CSS fallback.
const SVG_STYLE = `<style>
  .wb-bg      { fill: ${D.bg}; }
  .wb-panel   { fill: ${D.panel}; }
  .wb-outline { fill: none; stroke: ${D.border}; }
  .wb-line    { stroke: ${D.border}; }
  .wb-sep     { fill: ${D.border}; }
  .wb-label   { fill: ${D.label}; }
  .wb-value   { fill: ${D.value}; }
  @media (prefers-color-scheme: light) {
    .wb-bg      { fill: ${L.bg}; }
    .wb-panel   { fill: ${L.panel}; }
    .wb-outline { stroke: ${L.border}; }
    .wb-line    { stroke: ${L.border}; }
    .wb-sep     { fill: ${L.border}; }
    .wb-label   { fill: ${L.label}; }
    .wb-value   { fill: ${L.value}; }
  }
</style>`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: string) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtBytes(n: number | null | undefined): string {
	if (n == null) return '-';
	if (n === 0) return '0\u202fB';
	if (n < 1024) return `${n}\u202fB`;
	return `${(n / 1024).toFixed(1)}\u202fkB`;
}


function shortName(url: string, max = 26): string {
	try {
		const segs = new URL(url).pathname.split('/').filter(s => s && !s.startsWith('+'));
		const name = segs.at(-1) ?? url;
		return name.length > max ? name.slice(0, max - 1) + '\u2026' : name;
	} catch {
		return url.slice(0, max);
	}
}

function cw(s: string, fs = 10) {
	return Math.ceil(s.length * fs * 0.61);
}

// ─── SVG builder ─────────────────────────────────────────────────────────────

function buildSvg(
	rs: ResourceTimingEntry[],
	pkg: string,
	version: string,
	cdn: string,
	format: string,
): string {
	if (!rs.length) return '';

	const W   = 520;
	const PAD = 10;
	const H1  = 28;
	const R   = 4;
	const SH  = 18;
	const RH  = 14;

	const sorted = [...rs].sort((a, b) => a.startTime - b.startTime);

	// ── Group into rounds ────────────────────────────────────────────────────
	interface Round { idx: number; items: typeof sorted }
	const rounds: Round[] = [];
	let cur: typeof sorted = [sorted[0]];
	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i].startTime - sorted[i - 1].startTime > 5) {
			rounds.push({ idx: rounds.length, items: cur });
			cur = [];
		}
		cur.push(sorted[i]);
	}
	rounds.push({ idx: rounds.length, items: cur });

	const totalParsed = rs.reduce((s, r) => s + (r.decodedBodySize ?? 0), 0);
	const maxBytes    = Math.max(1, ...rs.map(r => r.decodedBodySize ?? 0));

	// ── Layout ───────────────────────────────────────────────────────────────
	const LABEL_W = 145;
	const SIZE_W  = 52;
	const BAR_X   = PAD + LABEL_W + SIZE_W;
	const BAR_W   = W - BAR_X - PAD;

	const totalRows = rounds.reduce((s, rd) => s + 1 + rd.items.length, 0);
	const H = H1 + SH + totalRows * RH + 6;

	// ── Header pills ─────────────────────────────────────────────────────────
	const fmtLabel = format.toUpperCase();
	const fmtColor = FORMAT_COLOR[format.toLowerCase()] ?? D.label;
	const pills = [
		{ text: cdn,      color: A.accent },
		{ text: fmtLabel, color: fmtColor },
	];
	let pillX = W - PAD;
	const pillEls: string[] = [];
	for (const p of [...pills].reverse()) {
		const pw = cw(p.text) + 12;
		pillX -= pw + 4;
		pillEls.unshift(
			`<rect x="${pillX}" y="6" width="${pw}" height="16" rx="3" fill="${p.color}" fill-opacity=".18" stroke="${p.color}" stroke-width=".5"/>` +
			`<text x="${(pillX + pw / 2).toFixed(1)}" y="18" text-anchor="middle" font-size="10" fill="${p.color}" font-family="${FONT}">${esc(p.text)}</text>`,
		);
	}

	// ── Stats line ───────────────────────────────────────────────────────────
	const statItems = [
		`${rs.length} file${rs.length !== 1 ? 's' : ''}`,
		`${fmtBytes(totalParsed)} total`,
		`${rounds.length} round trip${rounds.length !== 1 ? 's' : ''}`,
	];
	let sx = PAD;
	const statEls: string[] = [];
	for (let i = 0; i < statItems.length; i++) {
		statEls.push(
			`<text x="${sx}" y="${H1 + 13}" font-family="${FONT}" font-size="10" class="wb-label" fill="${D.label}">${esc(statItems[i])}</text>`,
		);
		sx += cw(statItems[i]) + 5;
		if (i < statItems.length - 1) {
			statEls.push(
				`<text x="${sx}" y="${H1 + 13}" font-family="${FONT}" font-size="10" class="wb-sep" fill="${D.border}">·</text>`,
			);
			sx += cw('·') + 5;
		}
	}

	// ── Content rows ─────────────────────────────────────────────────────────
	// Round N's bar offset = sum of max bar widths of rounds 0..N-1.
	// Scale the whole thing so the total fits exactly in BAR_W.
	const rawW = (bytes: number) => (bytes / maxBytes) * BAR_W;
	const roundMaxRaw = rounds.map(rd =>
		Math.max(4, ...rd.items.map(r => rawW(r.decodedBodySize ?? 0))),
	);
	const totalRaw = roundMaxRaw.reduce((s, w) => s + w, 0);
	const scale    = BAR_W / Math.max(totalRaw, 1);
	const roundOffsets = rounds.map((_, i) =>
		roundMaxRaw.slice(0, i).reduce((s, w) => s + w * scale, 0),
	);

	const rowEls: string[] = [];
	let ry = H1 + SH;

	for (const round of rounds) {
		const rc = ROUND_COLORS[Math.min(round.idx, ROUND_COLORS.length - 1)];
		const roundLabel  = `ROUND ${round.idx + 1}`;
		rowEls.push(
			`<text x="${PAD}" y="${ry + RH - 3}" font-family="${FONT}" font-size="9" fill="${rc}" letter-spacing=".05em">${esc(roundLabel)}</text>`,
		);
		ry += RH;

		for (let ri = 0; ri < round.items.length; ri++) {
			const r    = round.items[ri];
			const barL = roundOffsets[round.idx];
			const barW = Math.max(4, rawW(r.decodedBodySize ?? 0) * scale);
			const name = shortName(r.url);
			const size = fmtBytes(r.decodedBodySize ?? r.transferSize);
			const altBg = `<rect x="${BAR_X}" y="${ry + 3}" width="${BAR_W}" height="${RH - 6}" rx="1.5" fill="#000" fill-opacity=".06"/>`;
			rowEls.push(
				altBg +
				`<text x="${PAD}" y="${ry + RH - 3}" font-family="${FONT}" font-size="9.5" class="wb-value" fill="${D.value}">${esc(name)}</text>` +
				`<text x="${BAR_X - 4}" y="${ry + RH - 3}" text-anchor="end" font-family="${FONT}" font-size="9.5" class="wb-label" fill="${D.label}">${esc(size)}</text>` +
				`<rect x="${(BAR_X + barL).toFixed(1)}" y="${ry + 3}" width="${barW.toFixed(1)}" height="${RH - 6}" rx="1.5" fill="${rc}" fill-opacity=".8"/>`,
			);
			ry += RH;
		}
	}

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="max-width:100%;height:auto">`,
		SVG_STYLE,
		// Background + border — class overrides attribute in CSS-capable renderers
		`<rect width="${W}" height="${H}" rx="${R}" class="wb-bg" fill="${D.bg}"/>`,
		`<rect width="${W}" height="${H}" rx="${R}" class="wb-outline" fill="none" stroke="${D.border}" stroke-width="1"/>`,
		// Header panel
		`<rect width="${W}" height="${H1}" rx="${R}" class="wb-panel" fill="${D.panel}"/>`,
		`<rect y="${H1 - R}" width="${W}" height="${R}" class="wb-panel" fill="${D.panel}"/>`,
		`<line x1="0" y1="${H1}" x2="${W}" y2="${H1}" class="wb-line" stroke="${D.border}" stroke-width=".5"/>`,
		// Title
		`<text x="${PAD}" y="19" font-family="${FONT}" font-size="12" class="wb-value" fill="${D.value}" font-weight="bold">${esc(pkg)}<tspan class="wb-label" fill="${D.label}" font-weight="normal">@${esc(version)}</tspan></text>`,
		...pillEls,
		...statEls,
		`<line x1="0" y1="${H1 + SH}" x2="${W}" y2="${H1 + SH}" class="wb-line" stroke="${D.border}" stroke-width=".5"/>`,
		`<line x1="${BAR_X}" y1="${H1 + SH}" x2="${BAR_X}" y2="${H}" class="wb-line" stroke="${D.border}" stroke-width=".5" stroke-opacity=".4"/>`,
		...rowEls,
		`</svg>`,
	].join('\n');
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WaterfallBanner(props: Props) {
	const svg = createMemo(() => buildSvg(props.resources, props.pkg, props.version, props.cdn, props.format));
	return <div class={styles.wrap} innerHTML={svg()} />;
}
