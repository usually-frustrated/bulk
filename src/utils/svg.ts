import { CHAR_WIDTH, PAD_X } from '../constants';

export function generateBadgeSvg(labelText: string, sizeStr: string, isError: boolean): string {
	const labelWidth = labelText.length * CHAR_WIDTH + PAD_X;
	const valueWidth = sizeStr.length * CHAR_WIDTH + PAD_X * 1.5; // Extra padding for size text
	const totalWidth = labelWidth + valueWidth;
	const labelX = labelWidth / 2;
	const valueX = labelWidth + valueWidth / 2;
	const color = isError ? '#e05d44' : '#44cc11';

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${labelText}: ${sizeStr}">
  <title>${labelText}: ${sizeStr}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".05"/>
    <stop offset="1" stop-opacity=".05"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${labelX * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)">${labelText}</text>
    <text x="${labelX * 10}" y="140" transform="scale(.1)" fill="#fff">${labelText}</text>
    <text aria-hidden="true" x="${valueX * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)">${sizeStr}</text>
    <text x="${valueX * 10}" y="140" transform="scale(.1)" fill="#fff">${sizeStr}</text>
  </g>
</svg>`.trim();
}
