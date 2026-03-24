export const CDNS = ['esm.sh', 'jsdelivr', 'unpkg'] as const;
export type CDN = (typeof CDNS)[number];
export const DEFAULT_CDN: CDN = 'esm.sh';

/** Data confidence tier per Decision 2 / Decision 7. */
export type Confidence = 'established' | 'tentative' | 'server-estimate' | 'no-data';

export interface ExportEntry {
	/** Normalised key used throughout the app: 'index', 'jsx-runtime', etc. */
	key: string;
	/** Original resolved file path from package.json: './index.js', etc. */
	path: string;
}

export interface SizeResult {
	/** Uncompressed body size. Populated when HEAD has no Content-Length. */
	bytes_raw: number | null;
	/** Content-Length from HEAD (compressed transfer size). Preferred when available. */
	bytes_transfer: number | null;
}

/** SizeResult enriched with crowd-sourced confidence metadata. */
export interface MeasuredSize extends SizeResult {
	confidence: Confidence;
	sampleCount: number;
}

// ─── URL construction ────────────────────────────────────────────────────────

export function buildCdnUrl(
	pkg: string,
	version: string,
	exportKey: string,
	resolvedPath: string,
	cdn: CDN,
): string {
	const isRoot = exportKey === 'index';
	const subpath = isRoot ? '' : `/${exportKey}`;
	const filePath = resolvedPath.replace(/^\.\//, '');

	switch (cdn) {
		case 'esm.sh':
			// esm.sh understands export keys natively
			return `https://esm.sh/${pkg}@${version}${subpath}`;

		case 'jsdelivr':
			// jsDelivr needs the actual file path; +esm suffix for the root ESM entry
			if (isRoot) return `https://cdn.jsdelivr.net/npm/${pkg}@${version}/+esm`;
			return `https://cdn.jsdelivr.net/npm/${pkg}@${version}/${filePath}`;

		case 'unpkg':
			if (isRoot) return `https://unpkg.com/${pkg}@${version}`;
			return `https://unpkg.com/${pkg}@${version}/${filePath}`;
	}
}

// ─── Size measurement ────────────────────────────────────────────────────────

/**
 * Measure the size of a CDN URL.
 *
 * Strategy:
 *   1. HEAD → Content-Length present → bytes_transfer (compressed), no body download.
 *   2. HEAD → no Content-Length (chunked) → GET → body.byteLength → bytes_raw,
 *      plus bytes_transfer from Content-Length if the GET response includes it.
 */
export async function measureSize(url: string): Promise<SizeResult> {
	const head = await fetch(url, { method: 'HEAD', redirect: 'follow' });
	if (!head.ok) {
		const status = head.status === 404 ? 404 : 502;
		throw Object.assign(new Error(`CDN returned ${head.status} for ${url}`), { status });
	}

	const headCL = head.headers.get('Content-Length');
	if (headCL) {
		return { bytes_raw: null, bytes_transfer: parseInt(headCL, 10) };
	}

	// CDN uses chunked transfer — download body to measure
	const get = await fetch(url, { redirect: 'follow' });
	if (!get.ok) {
		const status = get.status === 404 ? 404 : 502;
		throw Object.assign(new Error(`CDN returned ${get.status} for ${url}`), { status });
	}

	const body = await get.arrayBuffer();
	const getCL = get.headers.get('Content-Length');

	return {
		bytes_raw: body.byteLength,
		bytes_transfer: getCL ? parseInt(getCL, 10) : null,
	};
}

// ─── exports field parsing ───────────────────────────────────────────────────

/** Resolve a condition map or array to a concrete file path. */
function resolveConditions(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (Array.isArray(value)) {
		for (const item of value) {
			const r = resolveConditions(item);
			if (r) return r;
		}
		return null;
	}
	if (typeof value !== 'object' || !value) return null;
	const v = value as Record<string, unknown>;
	// Prefer browser-appropriate ESM over CJS
	for (const cond of ['browser', 'import', 'module', 'default']) {
		if (v[cond] != null) {
			const r = resolveConditions(v[cond]);
			if (r) return r;
		}
	}
	return null;
}

function normaliseKey(key: string): string {
	return key === '.' ? 'index' : key.replace(/^\.\//, '');
}

/**
 * Extract the public export surface from a package.json object.
 * Falls back to main/module/browser if no `exports` field is present.
 */
export function parseExports(pkgJson: Record<string, unknown>): ExportEntry[] {
	const raw = pkgJson.exports;

	if (!raw) {
		const path =
			(typeof pkgJson.module === 'string' && pkgJson.module) ||
			(typeof pkgJson.browser === 'string' && pkgJson.browser) ||
			(typeof pkgJson.main === 'string' && pkgJson.main) ||
			'./index.js';
		return [{ key: 'index', path }];
	}

	if (typeof raw === 'string') {
		return [{ key: 'index', path: raw }];
	}

	if (typeof raw !== 'object' || Array.isArray(raw)) {
		return [{ key: 'index', path: './index.js' }];
	}

	const map = raw as Record<string, unknown>;
	const entries: ExportEntry[] = [];

	for (const [dotKey, value] of Object.entries(map)) {
		if (!dotKey.startsWith('.')) continue; // skip non-path conditions at root
		const path = resolveConditions(value);
		if (path) entries.push({ key: normaliseKey(dotKey), path });
	}

	return entries.length ? entries : [{ key: 'index', path: './index.js' }];
}
