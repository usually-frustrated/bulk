export interface Env {
	ASSETS: Fetcher;

	// KV — CDN size results (no expiry for pinned versions) + @latest resolution (1hr TTL)
	CACHE: KVNamespace;
}

export interface BundleRequest {
	package: string;
	version: string;
	exportPath: string;
}
