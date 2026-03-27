export interface DetectedFormats {
	umd:      string | null; // relative file path within the package, or null
	cjs:      string | null;
	systemjs: string | null;
	iife:     string | null;
}

// Ranked patterns per format — earlier entries = higher priority.
// First match wins; the matched file path is returned as the format's path.
const PATTERNS: Record<keyof DetectedFormats, RegExp[]> = {
	umd: [
		/\.umd\.min\.js$/i,
		/\.umd\.production\.min\.js$/i,
		/\.umd\.prod\.min\.js$/i,
		/\.umd\.js$/i,
		/\/umd\/[^/]+\.min\.js$/i,
		/\/umd\/[^/]+\.js$/i,
	],
	cjs: [
		/\.cjs\.min\.js$/i,
		/\.cjs\.js$/i,
		/\.cjs$/i,
		/\.commonjs(\.min)?\.js$/i,
		/\/cjs\/[^/]+\.min\.js$/i,
		/\/cjs\/[^/]+\.js$/i,
	],
	systemjs: [
		/\.system\.min\.js$/i,
		/\.system\.js$/i,
	],
	iife: [
		/\.iife\.min\.js$/i,
		/\.global\.min\.js$/i,
		/\.iife\.js$/i,
		/\.global\.js$/i,
	],
};

/**
 * Scan a flat package file listing (paths like "dist/index.umd.min.js")
 * and return the best representative file for each detectable bundle format.
 * ESM is always available via CDN transform and is not listed here.
 */
export function detectFormats(files: string[]): DetectedFormats {
	const result: DetectedFormats = { umd: null, cjs: null, systemjs: null, iife: null };
	for (const [fmt, patterns] of Object.entries(PATTERNS) as [keyof DetectedFormats, RegExp[]][]) {
		for (const pat of patterns) {
			const found = files.find(f => pat.test(f));
			if (found) {
				result[fmt] = found;
				break;
			}
		}
	}
	return result;
}
