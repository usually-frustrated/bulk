import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SolidPlugin } from '@dschz/bun-plugin-solid';

const clientDir = join(import.meta.dir, 'src', 'client');
const outDir = join(import.meta.dir, 'public');

if (existsSync(outDir)) {
	rmSync(outDir, { recursive: true });
}
mkdirSync(outDir, { recursive: true });

const buildResult = await Bun.build({
	entrypoints: [join(clientDir, 'main.tsx')],
	outdir: outDir,
	minify: true,
	target: 'browser',
	plugins: [SolidPlugin()],
});

if (!buildResult.success) {
	console.error('Build failed:');
	for (const log of buildResult.logs) {
		console.error(log);
	}
	process.exit(1);
}

const css = readFileSync(join(outDir, 'main.css'), 'utf-8');
const html = readFileSync(join(clientDir, 'index.html'), 'utf-8');
const htmlWithCss = html.replace('</head>', `<style>${css}</style>\n</head>`);
writeFileSync(join(outDir, 'index.html'), htmlWithCss);

console.log('Client build complete.');
