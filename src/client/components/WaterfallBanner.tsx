import { createMemo } from 'solid-js';
import type { ResourceTimingEntry } from '../utils/measurement';
import styles from './WaterfallBanner.module.css';

interface Props {
	resources: ResourceTimingEntry[];
	pkg:       string;
	version:   string;
	cdn:       string;
}

// ─── Design tokens (GitHub dark card) ────────────────────────────────────────

const FONT = "'Cascadia Code',monospace";

const C = {
	bg:     '#0d1117',
	panel:  '#161b22',
	border: '#30363d',
	label:  '#8b949e',
	value:  '#e6edf3',
	accent: '#58a6ff',
	green:  '#3fb950',
	yellow: '#d29922',
	red:    '#f85149',
} as const;

const ROUND_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149'] as const;

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

function fmtMs(ms: number) {
	return `${Math.round(ms)}\u202fms`;
}

function shortName(url: string, max = 26): string {
	try {
		const last = new URL(url).pathname.split('/').filter(Boolean).at(-1);
		const name = last ?? url;
		return name.length > max ? name.slice(0, max - 1) + '\u2026' : name;
	} catch {
		return url.slice(0, max);
	}
}

// Approximate char width for Cascadia Code (monospace) at given font-size.
function cw(s: string, fs = 10) {
	return Math.ceil(s.length * fs * 0.61);
}

// ─── SVG builder ─────────────────────────────────────────────────────────────

function buildSvg(
	rs: ResourceTimingEntry[],
	pkg: string,
	version: string,
	cdn: string,
): string {
	if (!rs.length) return '';

	const W   = 520;
	const PAD = 10;
	const H1  = 28;   // header band
	const R   = 4;
	const SH  = 18;   // stats line height
	const RH  = 14;   // row height for both round headers and resource rows

	const sorted = [...rs].sort((a, b) => a.startTime - b.startTime);
	const t0     = sorted[0].startTime;
	const tEnd   = Math.max(...sorted.map(r => r.responseEnd));
	const span   = Math.max(1, tEnd - t0);

	// ── Group into rounds ────────────────────────────────────────────────────
	interface Round { idx: number; offset: number; items: typeof sorted }
	const rounds: Round[] = [];
	let cur: typeof sorted = [sorted[0]];
	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i].startTime - sorted[i - 1].startTime > 5) {
			rounds.push({ idx: rounds.length, offset: cur[0].startTime - t0, items: cur });
			cur = [];
		}
		cur.push(sorted[i]);
	}
	rounds.push({ idx: rounds.length, offset: cur[0].startTime - t0, items: cur });

	const totalWire   = rs.reduce((s, r) => s + (r.transferSize   ?? 0), 0);
	const totalParsed = rs.reduce((s, r) => s + (r.decodedBodySize ?? 0), 0);

	// ── Layout ───────────────────────────────────────────────────────────────
	// Label col (filename) + size col | bar track
	const LABEL_W = 145;
	const SIZE_W  = 52;
	const BAR_X   = PAD + LABEL_W + SIZE_W;
	const BAR_W   = W - BAR_X - PAD;

	const totalRows = rounds.reduce((s, rd) => s + 1 + rd.items.length, 0);
	const H = H1 + SH + totalRows * RH + 6;

	// ── Header pills (CDN, ESM) ───────────────────────────────────────────
	const pills = [
		{ text: cdn,   color: C.accent },
		{ text: 'ESM', color: C.green  },
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
		`${fmtBytes(totalWire)} wire`,
		`${fmtBytes(totalParsed)} parsed`,
		`${rounds.length} round trip${rounds.length !== 1 ? 's' : ''}`,
		fmtMs(span) + ' total',
	];
	let sx = PAD;
	const statEls: string[] = [];
	for (let i = 0; i < statItems.length; i++) {
		statEls.push(
			`<text x="${sx}" y="${H1 + 13}" font-family="${FONT}" font-size="10" fill="${C.label}">${esc(statItems[i])}</text>`,
		);
		sx += cw(statItems[i]) + 5;
		if (i < statItems.length - 1) {
			statEls.push(
				`<text x="${sx}" y="${H1 + 13}" font-family="${FONT}" font-size="10" fill="${C.border}">·</text>`,
			);
			sx += cw('·') + 5;
		}
	}

	// ── Content rows ─────────────────────────────────────────────────────────
	const rowEls: string[] = [];
	let ry = H1 + SH;

	for (const round of rounds) {
		const rc = ROUND_COLORS[Math.min(round.idx, ROUND_COLORS.length - 1)];
		const roundLabel  = `ROUND ${round.idx + 1}`;
		const offsetLabel = `+${fmtMs(round.offset)}`;
		rowEls.push(
			`<text x="${PAD}" y="${ry + RH - 3}" font-family="${FONT}" font-size="9" fill="${rc}" letter-spacing=".05em">${esc(roundLabel)}</text>` +
			`<text x="${PAD + cw(roundLabel, 9) + 6}" y="${ry + RH - 3}" font-family="${FONT}" font-size="9" fill="${C.label}">${esc(offsetLabel)}</text>`,
		);
		ry += RH;

		for (let ri = 0; ri < round.items.length; ri++) {
			const r    = round.items[ri];
			const barL = ((r.startTime - t0) / span) * BAR_W;
			const barW = Math.max(4, ((r.responseEnd - r.startTime) / span) * BAR_W);
			const name = shortName(r.url);
			const size = fmtBytes(r.transferSize ?? r.decodedBodySize);
			const altBg = ri % 2 === 1
				? `<rect x="0" y="${ry}" width="${W}" height="${RH}" fill="${C.panel}" fill-opacity=".4"/>`
				: '';
			rowEls.push(
				altBg +
				`<text x="${PAD}" y="${ry + RH - 3}" font-family="${FONT}" font-size="9.5" fill="${C.value}">${esc(name)}</text>` +
				`<text x="${BAR_X - 4}" y="${ry + RH - 3}" text-anchor="end" font-family="${FONT}" font-size="9.5" fill="${C.label}">${esc(size)}</text>` +
				`<rect x="${(BAR_X + barL).toFixed(1)}" y="${ry + 3}" width="${barW.toFixed(1)}" height="${RH - 6}" rx="1.5" fill="${rc}" fill-opacity=".8"/>`,
			);
			ry += RH;
		}
	}

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="max-width:100%;height:auto">`,
		`<rect width="${W}" height="${H}" rx="${R}" fill="${C.bg}"/>`,
		`<rect width="${W}" height="${H}" rx="${R}" fill="none" stroke="${C.border}" stroke-width="1"/>`,
		`<rect width="${W}" height="${H1}" rx="${R}" fill="${C.panel}"/>`,
		`<rect y="${H1 - R}" width="${W}" height="${R}" fill="${C.panel}"/>`,
		`<line x1="0" y1="${H1}" x2="${W}" y2="${H1}" stroke="${C.border}" stroke-width=".5"/>`,
		`<text x="${PAD}" y="19" font-family="${FONT}" font-size="12" fill="${C.value}" font-weight="bold">${esc(pkg)}<tspan fill="${C.label}" font-weight="normal">@${esc(version)}</tspan></text>`,
		...pillEls,
		...statEls,
		`<line x1="0" y1="${H1 + SH}" x2="${W}" y2="${H1 + SH}" stroke="${C.border}" stroke-width=".5"/>`,
		`<line x1="${BAR_X}" y1="${H1 + SH}" x2="${BAR_X}" y2="${H}" stroke="${C.border}" stroke-width=".5" stroke-opacity=".4"/>`,
		...rowEls,
		`</svg>`,
	].join('\n');
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WaterfallBanner(props: Props) {
	const svg = createMemo(() => buildSvg(props.resources, props.pkg, props.version, props.cdn));
	return <div class={styles.wrap} innerHTML={svg()} />;
}
