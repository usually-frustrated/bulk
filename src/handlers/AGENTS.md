# src/handlers — agent notes

## banner.ts — SVG banner endpoint

Routes: `/_banner/(compact|standard|full)/<pkg>[@version]`

### standard banner flow
1. Parse pkg + version hint from URL path (handles `@scope/name@version`)
2. `cdn` from `?cdn=` param (default: jsdelivr)
3. `resolveVersion` — D1 cache 1h → npm registry
4. `getPackageExports` — export list (for exportCount)
5. Size: `getMeasuredSize` (P50 browser) → `getCachedSize` (D1) → live `measureSize` (HEAD/GET)
6. **`getLatestResourceTimings(pkg, version, 'index', cdn, env)`** — latest session batch from D1
   - Derives `fileCount`, `roundTrips` (gap > 5ms = new round), `durationMs` from timing rows
   - Passes `resources` array to `generateStandardBanner` → waterfall SVG layout
7. On any error → returns error banner SVG (never throws a 5xx)

### compact banner flow
Size from `getMeasuredSize` → `getCachedSize`. Confidence: established (≥40 samples),
tentative (10-39), server-estimate (HEAD-only). No resource timings fetched.

### full banner flow
`getMeasuredSize` → `getCachedSize` for every export in parallel. No resource timings.

---

## measurement.ts — /_record (POST)

Receives `{cdn, browser, connection, resources: ResourceTiming[]}` from client.
Filters to `transferSize > 0` (non-cached), then `ctx.waitUntil(saveResourceTimings(...))`.
`ResourceTiming` interface: `{url, pkg, version, exportKey, transferSize, decodedBodySize, startTime, responseEnd, initiatorType}`.

---

## discover.ts — /_discover/<pkg>

Returns `{package, version, exports: [{key, path}], wildcardResolved}`.
Resolution: `pkgJson.exports` → `parseExports`; no `exports` → jsDelivr flat API tarball scan.

---

## bundle.ts — /_bundle/<pkg>[@ver][/<export>]

Single-export or all-exports size. Prefers browser P50 (`getMeasuredSize`) over server estimate.

---

## bundle-history.ts — /_bundle-history/* (LEGACY)

Not called by the UI anymore. The UI uses `/_versions/` + per-version `/_bundle/` instead.
Handler still exists; do not remove without checking nothing else calls it.

---

## versions.ts — /_versions/<pkg>

Cheap version list only (no sizes). Returns `{versions: [{version, publishedAt}]}`.
Used by `BundleHistory` component for the chart X-axis skeleton.

---

## badge.ts — catch-all `/*`

Server-side size badge (compact SVG). Uses `providers.ts` CDN (root pkg only, no export path).
Not the same as `/_banner/compact/` — badge.ts uses HEAD estimate only, no D1 P50.

---

## clear-cache.ts — /_clear/<pkg>

Invalidates `cdn_sizes` rows for a package. Admin endpoint.
