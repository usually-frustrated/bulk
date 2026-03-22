import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, renameSync, copyFileSync } from 'fs';
import { join } from 'path';
import { SolidPlugin } from '@dschz/bun-plugin-solid';

const clientDir = join(import.meta.dir, 'src', 'client');
const outDir = join(import.meta.dir, 'public');

// Only remove if it exists
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

// Move compiled CSS into the /_/ static asset namespace
mkdirSync(join(outDir, '_'), { recursive: true });
renameSync(join(outDir, 'main.css'), join(outDir, '_', 'styles.css'));

// Copy index.html as-is; it links to /_/styles.css via <link> tag
const html = readFileSync(join(clientDir, 'index.html'), 'utf-8');
writeFileSync(join(outDir, 'index.html'), html);

// Copy logo into the /_/ static asset namespace
copyFileSync(join(clientDir, 'logo.png'), join(outDir, '_', 'logo.png'));

console.log('Client build complete.');
