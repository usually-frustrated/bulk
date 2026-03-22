import type { Env } from '../types';
import { CDNS } from '../utils/cdn';

// ─── Measurement result types ────────────────────────────────────────────────

export interface ResourceTiming {
  url: string;
  transferSize: number | null;
  decodedBodySize: number | null;
  startTime: number;
  responseEnd: number;
  initiatorType: string;
}

export interface MeasurementResult {
  packages: string[];
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
    const body = await request.json() as MeasurementResult;
    
    // Validate required fields
    if (!body.packages || !Array.isArray(body.packages) || body.packages.length === 0) {
      return new Response('Invalid packages array', { status: 400 });
    }
    
    if (!body.cdn || !CDNS.includes(body.cdn as any)) {
      return new Response('Invalid CDN', { status: 400 });
    }
    
    if (!body.browser || typeof body.browser !== 'string') {
      return new Response('Invalid browser string', { status: 400 });
    }
    
    if (!body.connection || typeof body.connection !== 'string') {
      return new Response('Invalid connection string', { status: 400 });
    }
    
    if (!body.resources || !Array.isArray(body.resources)) {
      return new Response('Invalid resources array', { status: 400 });
    }
    
    // TODO: Store in D1 database
    // For now, we'll just log it to demonstrate the structure
    
    console.log('Recording measurement:', JSON.stringify(body, null, 2));
    
    return new Response('Measurement recorded', { status: 200 });
  } catch (err) {
    return new Response('Invalid request body', { status: 400 });
  }
}