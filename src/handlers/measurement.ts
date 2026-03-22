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
  version: string; // Track which version of the site created this data
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
    
    if (!body.version || typeof body.version !== 'string') {
      return new Response('Invalid version string', { status: 400 });
    }
    
    if (!body.resources || !Array.isArray(body.resources)) {
      return new Response('Invalid resources array', { status: 400 });
    }
    
    // Store in D1 database - simplified for now
    // In a real implementation, this would store the actual measurement data in D1
    
    // For now, just log it
    console.log('Recording measurement:', JSON.stringify({
      ...body,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    // In a real implementation, you would do something like:
    /*
    await env.DB.prepare(
      `INSERT INTO measurements (package, cdn, browser, connection, version, resources, timestamp) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      body.packages[0], 
      body.cdn, 
      body.browser, 
      body.connection,
      body.version,
      JSON.stringify(body.resources),
      new Date().toISOString()
    )
    .run();
    */
    
    return new Response('Measurement recorded successfully', { status: 200 });
  } catch (err) {
    console.error('Error recording measurement:', err);
    return new Response('Invalid request body', { status: 400 });
  }
}