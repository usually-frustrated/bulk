import type { Env } from '../types';

interface JobRow {
	id: string;
	package: string;
	version: string;
	export_path: string;
	status: 'pending' | 'processing' | 'completed' | 'failed';
	bytes: number | null;
	error: string | null;
}

/** Approximate position in queue — count of pending jobs created before this one. */
async function queuePosition(env: Env, jobId: string): Promise<number> {
	const row = await env.DB.prepare(
		`SELECT COUNT(*) as pos FROM bundle_jobs
		 WHERE status = 'pending'
		   AND created_at < (SELECT created_at FROM bundle_jobs WHERE id = ?)`,
	)
		.bind(jobId)
		.first<{ pos: number }>();
	return (row?.pos ?? 0) + 1;
}

function encode(event: string, data: object): Uint8Array {
	return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * GET /_bundle-status/:jobId
 *
 * - If the client sends `Accept: text/event-stream`, opens an SSE stream that
 *   polls D1 every 2 s and pushes events until the job is terminal or 60 s pass.
 *   The client falls back to polling if the SSE connection drops or isn't supported.
 *
 * - Otherwise returns a JSON snapshot of the current job state.
 *   202 → still pending/processing
 *   200 → completed
 *   422 → failed
 *   404 → unknown job id
 */
export async function handleBundleStatus(request: Request, env: Env): Promise<Response> {
	const jobId = new URL(request.url).pathname.replace('/_bundle-status/', '');
	if (!jobId) return new Response('Missing job id', { status: 400 });

	const wantsSSE = request.headers.get('Accept') === 'text/event-stream';

	if (!wantsSSE) {
		return jsonSnapshot(jobId, env);
	}

	// SSE path
	const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
	const writer = writable.getWriter();

	streamUntilDone(jobId, env, writer).catch(() => writer.close().catch(() => {}));

	return new Response(readable, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			// Allow the client to reconnect cleanly
			'X-Accel-Buffering': 'no',
		},
	});
}

async function jsonSnapshot(jobId: string, env: Env): Promise<Response> {
	const job = await env.DB.prepare(`SELECT * FROM bundle_jobs WHERE id = ?`)
		.bind(jobId)
		.first<JobRow>();

	if (!job) return new Response('Job not found', { status: 404 });

	if (job.status === 'completed') {
		return Response.json({
			status: 'completed',
			package: job.package,
			version: job.version,
			export: job.export_path,
			bytes: job.bytes,
		});
	}

	if (job.status === 'failed') {
		return Response.json({ status: 'failed', error: job.error }, { status: 422 });
	}

	return Response.json({ status: job.status, jobId }, { status: 202 });
}

async function streamUntilDone(
	jobId: string,
	env: Env,
	writer: WritableStreamDefaultWriter<Uint8Array>,
): Promise<void> {
	const POLL_MS = 2_000;
	const TIMEOUT_MS = 60_000;
	const deadline = Date.now() + TIMEOUT_MS;

	try {
		while (Date.now() < deadline) {
			const job = await env.DB.prepare(`SELECT * FROM bundle_jobs WHERE id = ?`)
				.bind(jobId)
				.first<JobRow>();

			if (!job) {
				await writer.write(encode('error', { error: 'Job not found' }));
				break;
			}

			if (job.status === 'completed') {
				await writer.write(
					encode('completed', {
						package: job.package,
						version: job.version,
						export: job.export_path,
						bytes: job.bytes,
					}),
				);
				break;
			}

			if (job.status === 'failed') {
				await writer.write(encode('failed', { error: job.error }));
				break;
			}

			// Still in flight — send a heartbeat with approximate position
			const position = job.status === 'pending' ? await queuePosition(env, jobId) : null;
			await writer.write(encode('pending', { jobId, status: job.status, position }));

			await sleep(POLL_MS);
		}

		if (Date.now() >= deadline) {
			// Tell the client to switch to polling — don't keep the stream open forever
			await writer.write(
				encode('timeout', {
					message: 'Job is still running. Poll /_bundle-status/' + jobId + ' for updates.',
					jobId,
				}),
			);
		}
	} finally {
		await writer.close();
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
