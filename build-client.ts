import { cpSync, mkdirSync, rmSync, existsSync } from 'fs';
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

cpSync(join(clientDir, 'index.html'), join(outDir, 'index.html'));

console.log('Client build complete.');
