import type { Env } from '../types';
import { CDNS } from '../utils/cdn';
import { saveResourceTimings } from '../utils/db';

// ─── Measurement result types ────────────────────────────────────────────────

export interface ResourceTiming {
	url: string;
	pkg: string;
	version: string;
	exportKey: string;
	transferSize: number | null;
	decodedBodySize: number | null;
	startTime: number;
	responseEnd: number;
	initiatorType: string;
}

export interface MeasurementResult {
	cdn: string;
	browser: string;
	connection: string;
	resources: ResourceTiming[];
}

// ─── POST /_record endpoint ──────────────────────────────────────────────────

export async function handleRecordRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	if (request.method !== 'POST') {
		return new Response('Method not allowed', { status: 405 });
	}

	try {
		const body = (await request.json()) as MeasurementResult;

		if (!body.cdn || !CDNS.includes(body.cdn as never)) {
			return new Response('Invalid CDN', { status: 400 });
		}
		if (!body.browser || typeof body.browser !== 'string') {
			return new Response('Invalid browser', { status: 400 });
		}
		if (!body.connection || typeof body.connection !== 'string') {
			return new Response('Invalid connection', { status: 400 });
		}
		if (!Array.isArray(body.resources) || !body.resources.length) {
			return new Response('Invalid resources', { status: 400 });
		}

		// Filter to entries that have a positive transferSize (not cached)
		const measurable = body.resources.filter(
			(r) => typeof r.transferSize === 'number' && r.transferSize > 0,
		);

		if (measurable.length > 0) {
			ctx.waitUntil(
				saveResourceTimings(measurable, body.cdn, body.browser, body.connection, env),
			);
		}

		return new Response('ok', { status: 200 });
	} catch {
		return new Response('Invalid request body', { status: 400 });
	}
}
