export interface Env {
	ASSETS: Fetcher;

	// D1 database — bundle_cache and bundle_jobs tables
	DB: D1Database;

	// KV — resolved semver for @latest tags, 1hr TTL
	VERSION_CACHE: KVNamespace;

	// Queue producer — sends bundle jobs to the consumer
	BUNDLE_QUEUE: Queue<BundleJobMessage>;

	// Durable Object — atomic queue depth counter for backpressure
	QUEUE_COUNTER: DurableObjectNamespace;

	// Vars
	MAX_QUEUE: string;
}

export interface BundleJobMessage {
	jobId: string;
	package: string;
	version: string; // always a resolved semver, never "latest"
	exportPath: string;
}

export interface BundleRequest {
	package: string;
	version: string;
	exportPath: string;
}
