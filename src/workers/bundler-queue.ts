import * as esbuild from 'esbuild-wasm';
import type { Env, BundleJobMessage } from '../types';
import { httpPlugin } from '../utils/esbuild-http-plugin';

// ESBUILD_WASM is injected by wrangler as a WebAssembly.Module global
// (see wasm_modules in wrangler.jsonc)
declare const ESBUILD_WASM: WebAssembly.Module;

let esbuildReady: Promise<void> | null = null;

function getEsbuild(): Promise<void> {
	if (!esbuildReady) {
		esbuildReady = esbuild.initialize({ wasmModule: ESBUILD_WASM, worker: false });
	}
	return esbuildReady;
}

async function computeBytes(pkg: string, version: string, exportPath: string): Promise<number> {
	await getEsbuild();

	// esm.sh pre-converts CJS→ESM, compiles TypeScript, and serves a single
	// ES module per package export — ideal for accurate bundle-size measurement.
	const base = `https://esm.sh/${pkg}@${version}`;
	const url = exportPath === 'index' ? base : `${base}/${exportPath}`;
	const entry = `export * from '${url}'`;

	const result = await esbuild.build({
		stdin: { contents: entry, loader: 'js', resolveDir: '/' },
		bundle: true,
		minify: true,
		format: 'esm',
		plugins: [httpPlugin],
		write: false,
	});

	return result.outputFiles[0].contents.byteLength;
}

function counterStub(env: Env): DurableObjectStub {
	const id = env.QUEUE_COUNTER.idFromName('global');
	return env.QUEUE_COUNTER.get(id);
}

export async function handleQueue(batch: MessageBatch<BundleJobMessage>, env: Env): Promise<void> {
	// max_batch_size is 1, so this loop runs exactly once per invocation
	for (const message of batch.messages) {
		const { jobId, package: pkg, version, exportPath } = message.body;

		try {
			await env.DB.prepare(`UPDATE bundle_jobs SET status = 'processing' WHERE id = ?`)
				.bind(jobId)
				.run();

			const bytes = await computeBytes(pkg, version, exportPath);

			await env.DB.batch([
				// Permanent cache entry — safe to ignore conflicts (e.g. race between two jobs)
				env.DB
					.prepare(
						`INSERT OR IGNORE INTO bundle_cache (package, version, export_path, bytes)
						 VALUES (?, ?, ?, ?)`,
					)
					.bind(pkg, version, exportPath, bytes),

				env.DB
					.prepare(
						`UPDATE bundle_jobs
						 SET status = 'completed', bytes = ?, completed_at = datetime('now')
						 WHERE id = ?`,
					)
					.bind(bytes, jobId),
			]);

			message.ack();
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);

			await env.DB.prepare(
				`UPDATE bundle_jobs SET status = 'failed', error = ? WHERE id = ?`,
			)
				.bind(error, jobId)
				.run();

			// Acknowledge even on failure — the error is persisted in D1 and the
			// client will receive it on next poll/SSE tick. Retries are handled by
			// re-submitting a new job, not by re-queuing the same message.
			message.ack();
		} finally {
			// Always release the slot so the counter stays accurate
			await counterStub(env).fetch('http://do/decrement').catch(() => {});
		}
	}
}
