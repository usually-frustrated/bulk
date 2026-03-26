# src/utils — agent notes

## svg.ts — SVG generation

### Types
```typescript
BannerResource { url, startTime, responseEnd, transferSize }

BannerData {
  pkg, version, cdn, bytes, exportCount, hasEsm, hasUmd, isError, errorMsg?
  fileCount?, roundTrips?, durationMs?   // aggregated stats for stats line
  resources?: BannerResource[]           // triggers waterfall layout when set
}
```

### generateStandardBanner — two layout modes
**Waterfall** (resources present): dynamic height `28 + 18 + N×13 + 5`. Stats text line
(18px), then per-resource rows: 145px filename label + 355px bar track. Bars positioned
and sized proportional to `startTime`/`responseEnd`. Round-trip colour coding:
`[accent, green, yellow, red]` — gap > 5ms between consecutive start times = new round.

**Fallback** (no resources): fixed 64px. Single progress bar (bytes / 500 kB reference) + stats text.

Helper `waterfallFilename(url, maxLen=22)` — extracts last path segment, truncates with `…`.

### generateFullBanner
One row per export. Bar proportional to bytes vs. max-export bytes (not 500 kB).

### generateBadgeSvg
Classic two-pill shield. Confidence: established=green, tentative=yellow (~prefix),
server-estimate=yellow, no-data=dark + accent CTA text.

---

## db.ts — D1 database helpers

All functions accept `env: Env` (the Cloudflare Worker binding).

| Function | Table | Notes |
|----------|-------|-------|
| `resolveVersion(pkg, env)` | version_resolution | D1 cache 1h; falls back to npm registry `/latest` |
| `getPackageExports(pkg, version, env)` | package_exports | D1 cache forever; falls back to npm registry |
| `getCachedSize(pkg, version, exportKey, cdn, env)` | cdn_sizes | returns `{bytes_raw, bytes_transfer}` or null |
| `getCachedSizesBatch(...)` | cdn_sizes | bulk version lookup, returns `Map<version, CachedSize>` |
| `saveSize(...)` | cdn_sizes | upsert by (package,version,export_key,cdn) |
| `saveResourceTimings(resources, cdn, browser, connection, env)` | resource_timings | batch INSERT; skips zero-transferSize rows |
| `getMeasuredSize(pkg, version, exportKey, cdn, env)` | resource_timings | P50 median; returns null if < 10 samples (30-day window) |
| `getLatestResourceTimings(pkg, version, exportKey, cdn, env)` | resource_timings | all rows at MAX(timestamp) — latest session batch; used by banner waterfall |
| `getVersionList(pkg, env)` | package_versions | D1 cache 24h; falls back to npm registry time map |

### getLatestResourceTimings
Returns `ResourceTimingRow[]` with `{url, transfer_size, decoded_body_size, start_time, response_end}`.
Queries `WHERE timestamp = (SELECT MAX(timestamp) ...)` — relies on batched INSERTs sharing a SQLite
second-precision datetime. Limit 50 rows. Used by `banner.ts` to render per-file waterfall bars.

---

## cdn.ts — CDN URL building and size measurement

`buildCdnUrl(pkg, version, exportKey, path, cdn)` — constructs the right CDN URL per CDN.
`measureSize(url)` — HEAD → Content-Length; falls back to GET body length.
`parseExports(pkgJson)` — walks `exports` field, normalises `.`→`index`, `./foo`→`foo`.

---

## size.ts
`formatSize(bytes)` — `"0 B"` / `"1.2 kB"` / `"1.23 MB"`.

---

## telemetry.ts
`Telemetry.{info|warn|error|logAsync}` — thin wrapper; safe to call from Worker context.
