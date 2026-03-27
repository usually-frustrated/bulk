import type { Env } from '../types';
import { CDNS } from '../utils/cdn';
import type { CDN } from '../utils/cdn';
import { saveWaterfall } from '../utils/db';
import type { WaterfallRow } from '../utils/db';

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

		// Accept any resource with a known decoded size (transferSize may be 0 for cached)
		const measurable = body.resources.filter(
			(r) => typeof r.decodedBodySize === 'number' && r.decodedBodySize > 0,
		);

		if (measurable.length > 0) {
			// Compute round trips from startTime gaps (> 5 ms between consecutive
			// requests = new dependency depth level), then persist the structural
			// waterfall without raw timing data.
			ctx.waitUntil((async () => {
				const sorted = [...measurable].sort((a, b) => a.startTime - b.startTime);
				const rows: WaterfallRow[] = [];
				let roundTrip = 0;
				for (let i = 0; i < sorted.length; i++) {
					if (i > 0 && sorted[i].startTime - sorted[i - 1].startTime > 5) roundTrip++;
					rows.push({ round_trip: roundTrip, url: sorted[i].url, bytes: sorted[i].decodedBodySize });
				}
				// All measurable resources share the same pkg/version/exportKey from
				// the client-side annotation; use the first to key the waterfall row.
				const first = sorted[0];
				await saveWaterfall(first.pkg, first.version, first.exportKey, body.cdn as CDN, rows, env);
			})());
		}

		return new Response('ok', { status: 200 });
	} catch {
		return new Response('Invalid request body', { status: 400 });
	}
}
