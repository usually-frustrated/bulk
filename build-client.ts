import { cpSync } from 'fs';
import { join } from 'path';

const clientDir = join(import.meta.dir, 'src', 'client');
const outDir = join(import.meta.dir, 'public');

// Bundle the TypeScript entry point
const result = await Bun.build({
	entrypoints: [join(clientDir, 'main.ts')],
	outdir: outDir,
	minify: true,
	target: 'browser',
});

if (!result.success) {
	console.error('Build failed:');
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

// Copy static assets
cpSync(join(clientDir, 'index.html'), join(outDir, 'index.html'));
cpSync(join(clientDir, 'style.css'), join(outDir, 'style.css'));

console.log('Client build complete.');
