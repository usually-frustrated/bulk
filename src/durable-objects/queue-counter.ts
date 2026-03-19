import type { Env } from '../types';

/**
 * QueueCounter — a single globally-named Durable Object that enforces
 * the maximum pending+processing job count (MAX_QUEUE env var).
 *
 * The DO's single-threaded fetch guarantee makes the increment/decrement
 * pair atomic without needing transactions.
 *
 * State is persisted in DO storage so the count survives hibernation.
 */
export class QueueCounter {
	private readonly storage: DurableObjectStorage;
	private readonly maxQueue: number;

	constructor(state: DurableObjectState, env: Env) {
		this.storage = state.storage;
		this.maxQueue = parseInt(env.MAX_QUEUE ?? '200', 10);
	}

	async fetch(request: Request): Promise<Response> {
		const { pathname } = new URL(request.url);

		if (pathname === '/increment') {
			const count = (await this.storage.get<number>('count')) ?? 0;
			if (count >= this.maxQueue) {
				return Response.json(
					{ error: 'Queue full', current: count, max: this.maxQueue },
					{ status: 429 },
				);
			}
			await this.storage.put('count', count + 1);
			return Response.json({ count: count + 1 });
		}

		if (pathname === '/decrement') {
			const count = (await this.storage.get<number>('count')) ?? 0;
			const next = Math.max(0, count - 1);
			await this.storage.put('count', next);
			return Response.json({ count: next });
		}

		if (pathname === '/status') {
			const count = (await this.storage.get<number>('count')) ?? 0;
			return Response.json({ count, max: this.maxQueue });
		}

		return new Response('Not found', { status: 404 });
	}
}
