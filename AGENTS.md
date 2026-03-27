# AGENTS

> **CRITICAL — ALL AGENTS MUST FOLLOW THIS RULE:**
> After every session that changes code, discovers new behaviour, finds a bug, or corrects a wrong statement in this file, you MUST update AGENTS.md before pushing. Add new sections, update stale ones, and correct any inaccuracies. This file is the shared memory of the repo.
>
> **This rule applies to AGENTS.md itself:** if this file contains anything that no longer reflects the actual code, update it as part of the same commit. AGENTS.md must always be an accurate representation of what is currently true in the repo.

---

## ∑ stack
CF Worker · SolidJS · Bun · Wrangler · TypeScript · D1(SQLite) · vitest

---

## ⌂ layout
```
src/index.ts              ← worker entry · router (see routing section)
src/types.ts              ← Env{ASSETS:Fetcher, DB:D1Database}
src/constants.ts          ← SVG: CHAR_WIDTH · PAD_X · BADGE_LABEL
src/providers.ts          ← jsdelivr(dflt)|unpkg|skypack|esm.sh → {id,name,url(pkg)}
src/handlers/
  badge.ts                ← HEAD cdn → size → SVG · CF cache · telemetry
  bundle.ts               ← /_bundle/* · single/all-exports · D1 cache
  bundle-history.ts       ← /_bundle-history/* · all versions → sizes → JSON (legacy; not used by UI anymore)
  versions.ts             ← /_versions/<pkg> · cheap version-list only (NEW)
  discover.ts             ← /_discover/* · package.json export discovery + tarball fallback
  measurement.ts          ← /_record (POST) · compute round trips · save structural waterfall
  banner.ts               ← /_banner/(compact|standard|full)/<pkg> · real data from DB
  clear-cache.ts          ← /_clear/* · invalidate cached sizes
src/utils/
  pkg.ts                  ← parsePath · buildCacheControl · isImmutableVersion
  svg.ts                  ← generateBadgeSvg · generateStandardBanner · generateFullBanner
  size.ts                 ← formatSize(bytes)→"1.2 kB"
  cdn.ts                  ← buildCdnUrl · measureSize(HEAD→GET fallback) · parseExports
  db.ts                   ← resolveVersion · getPackageExports · getCachedSize · saveSize · getVersionList
                             · saveWaterfall · getLatestWaterfall · getMeasuredSizeFromWaterfall
  telemetry.ts            ← Telemetry.{info|warn|error|logAsync}
  bundle-parse.ts         ← parseBundlePath("/_bundle/<pkg>[@ver][/export]")
  wildcard.ts             ← fetchPackageFiles · expandWildcard (jsDelivr flat API)
src/client/
  main.tsx                ← SolidJS mount → #root
  App.tsx                 ← full app state · two-signal input model · dirty-state UI
  style.css               ← reset + CSS vars (light/dark) + layout
  index.html              ← links /_/styles.css · loads /main.js
  utils/
    measurement.ts        ← buildImportmapUrl · measurePackages (iframe) · getBrowserInfo
  components/
    Header.tsx            ← title + logo
    BundleHistory.tsx     ← SVG line chart · hollow/filled dots · on-demand size fetch
    Waterfall.tsx         ← network round-trip waterfall · groups by startTime gap
    OutputTabs.tsx        ← importmap JSON · import URLs · UMD script tag
    BadgeGenerator.tsx    ← badge + banner preview · copy-url buttons
    Footer.tsx            ← links/credits
    LoadingOverlay.tsx    ← exists as file but NO LONGER USED in App.tsx (removed)
migrations/0001_bundle_schema.sql ← D1 schema (5 tables + resource_timings)
build-client.ts           ← Bun.build(main.tsx,minify,SolidPlugin)→public/
wrangler.jsonc            ← main=src/index.ts · assets=./public · D1 binding · observability
```

---

## ⇒ routing (src/index.ts)
```
/favicon.ico                        → 404
/_/<static>                         → env.ASSETS.fetch  [CSS, JS, images]

── API ───────────────────────────────────────────────────────────────────────
/_bundle-history/<pkg>[/<export>]   → handleBundleHistory   (legacy; not called by UI)
/_versions/<pkg>                    → handleVersionsRequest  (version list only, cheap)
/_bundle/<pkg>[@ver][/<export>]     → handleBundleRequest    (single/all-export sizes)
/_discover/<pkg>                    → handleDiscoverRequest  (export discovery)
/_record  (POST)                    → handleRecordRequest    (browser timing ingestion)
/_banner/(compact|standard|full)/<pkg>[@ver] → handleBannerRequest (SVG banner)
/_clear/<pkg>                       → handleClearCache

── Catch-all ─────────────────────────────────────────────────────────────────
/<pkg>[@ver][?cdn=jsdelivr|unpkg|esm.sh]  → handleBadgeRequest  (SVG size badge)
```
Key ordering rule: `/_bundle-history/` before `/_bundle/`; `/_versions/` between them.
Static assets `/_/` are checked before any API route.
**No `/:provider/:package` path format** — CDN is selected via `?cdn=` query param only (default: jsdelivr).

---

## 🖥 client input model (App.tsx)

### Signals
```
pkgInput    (draft)     ← updated on every keystroke via onInput
pkg         (committed) ← updated only when user clicks "check" (handleMeasure)
cdn                     ← 'jsdelivr' | 'esm.sh' | 'unpkg'
selectedExport          ← '' (index) or export key string
format                  ← 'esm' | 'umd' | 'cjs' | 'iife' | 'systemjs'
measuredInput           ← pkgInput value at last successful measurement (null = never run)
measuredCdn             ← cdn at last measurement
measuredExport          ← selectedExport at last measurement
measuredFormat          ← format at last measurement
```

### Derived dirty flags
```
isDirty    = measuredInput===null || pkgInput!==measuredInput || cdn!==measuredCdn || selectedExport!==measuredExport || format!==measuredFormat
inputDirty = pkgInput !== pkg   ← text field changed since last commit; used to disable export dropdown
```

### URL query param sync
All four controls are reflected in the URL on every "check" click (via `syncAllParams`).
Defaults are omitted to keep the URL clean:
```
?pkg=<name>      omitted when pkg === 'react'
?cdn=<cdn>       omitted when cdn === 'jsdelivr'
?export=<key>    omitted when export === '' (index)
?format=<fmt>    omitted when format === 'esm'
```
On page load, all four are restored from URL params so a refresh never loses state.

### Dirty-state UI behaviour
- Export dropdown disabled when `inputDirty()` (exports list is stale for a new pkg)
- Results section, badge section, and BundleHistory section all dim to opacity 0.4 when `isDirty()`
- Check button shows a subtle periodic glow animation (`checkGlow` keyframe) while `isDirty()`
- Revert button (↩) appears next to check when `isDirty() && measuredInput !== null`; resets pkgInput/cdn/selectedExport to last measured values

### Discover flow
`/_discover/<pkg>` is called inside `handleMeasure` only — it does NOT fire reactively on every keystroke. Exports are populated only after a successful measurement run.

**Skip re-fetch rule (bug fix):** `handleMeasure` checks `discoverData()?.package === pkgName` before calling `/_discover`. If they match, the existing data is reused and `setDiscoverData` is NOT called. This prevents SolidJS's `<For>` from re-rendering the `<option>` list on every "check" click, which would reset the controlled `<select>` value and lose the user's export selection.

Effect on package change: when `firstPkg()` actually changes (new package typed), the `createEffect(on(firstPkg, ...))` fires, clears `discoverData`, clears `selectedExport`, and on the next measure the discover is re-fetched fresh.

---

## 📜 BundleHistory — on-demand architecture (refactored)

Old design fetched all version sizes in one shot via `/_bundle-history/*`.
**Current design** splits into two phases:

1. **Cheap version list** — called reactively when `props.pkg` changes:
   ```
   GET /_versions/<pkg>  → { versions: [{version, publishedAt}] }
   ```
   Returns version metadata only; no sizes. Fast, cheap.

2. **On-demand size fetch** — user-driven:
   - Hollow dot click → fetches size for that one version via `/_bundle/<pkg>@<ver>[/<export>]?cdn=jsdelivr`
   - Clicking a hollow dot also updates the package input to `pkg@version` (making inputs dirty, prompting re-measure)
   - "generate all" button → fetches all unmeasured versions in parallel (Promise.all)

3. **Chart state**:
   - `versions` signal: all VersionMeta from step 1
   - `sizes` signal: Map<version, VersionSize> populated on-demand
   - Dots are hollow (pointEmpty) when not in sizes map, dashed (pointPending) while fetching, filled (point) when done
   - Y-axis and area/line paths only render for versions with data
   - Tooltip shows "click to generate" for hollow dots

### Props
```typescript
interface Props {
  pkg: string;
  selectedExport: string;
  onVersionClick?: (version: string) => void;  // called on hollow-dot click; parent pins pkg@version in input
}
```

---

## 🌐 CDN url patterns
| cdn | root (importmap) | subpath |
|-----|-----------------|---------|
| esm.sh | `esm.sh/<pkg>@<ver>?bundle` | `esm.sh/<pkg>@<ver>/<key>?bundle` |
| jsdelivr | `cdn.jsdelivr.net/npm/<pkg>@<ver>/+esm` | `cdn.jsdelivr.net/npm/<pkg>@<ver>/<file>/+esm` |
| unpkg | `unpkg.com/<pkg>@<ver>?module` | `unpkg.com/<pkg>@<ver>/<key>?module` |

**esm.sh `?bundle` is intentional**: without it, esm.sh resolves transitive deps as separate HTTP requests, inflating the waterfall and measurement. `?bundle` collapses non-peer deps into the bundle, but **does NOT bundle peer dependencies** (e.g. react, react-dom) — those still become separate imports.

Server-side CDN URLs (cdn.ts `buildCdnUrl`) do NOT use `?bundle` — those are used for HEAD size measurement only, not browser import.

---

## 📐 size measurement strategy

### Server-side (cdn.ts `measureSize`)
```
HEAD → Content-Length present → bytes_transfer (compressed, preferred)
HEAD → no Content-Length (chunked) → GET → body.byteLength → bytes_raw
       also check GET Content-Length → bytes_transfer if present
```

### Browser-side (measurement.ts `measurePackages`)

**One measurement baseline for all formats/CDNs:**

| Format | Mechanism | Why |
|--------|-----------|-----|
| ESM (all CDNs) | `<script type="importmap">` + `<script type="module">` with dynamic `import()` | Module scripts are implicitly CORS; `decodedBodySize` is always exposed |
| UMD / CJS / IIFE / SystemJS | `fetch(url).then(r => r.blob())` | Classic `<script>` is no-CORS, zeroing `decodedBodySize` even with `Timing-Allow-Origin: *`; `fetch()` is CORS by default, jsDelivr responds with `Access-Control-Allow-Origin: *` |

**Never use classic `<script src>` for bundle measurement** — no-CORS requests expose zero size data in the Performance API regardless of server headers. `fetch()` is the single reliable baseline.

After measurement:
- `performance.getEntriesByType('resource')` is read from the iframe
- Primary resource annotated by exact URL match; remaining own-package resources by `isOwnResource(url, pkg)`
- `ownResources = rawResources.filter(r => r.pkg !== undefined)` — only own-package resources passed to `WaterfallBanner`, preventing transitive CDN deps from appearing in the SVG
- Results reported to `/_record` (POST, fire-and-forget); only annotated resources with `decodedBodySize > 0` are sent

**Dependency isolation (externalDeps)**:
- `/_discover` returns `externalDeps: string[]` (peerDependencies + dependencies names from package.json)
- `measurePackages` stubs every dep with `data:application/javascript,export {};` in the importmap
- For **esm.sh**: CDN URL gains `&external=dep1,dep2,...` so the bundle emits bare-specifier imports that the importmap can intercept → zero dep network requests
- For **jsDelivr / unpkg**: stubs are added but CDNs rewrite imports to absolute URLs → stubs have no effect; the `ownResources` filter ensures those dep requests are excluded from the waterfall display

---

## 🎨 banner SVG (svg.ts + banner.ts)

### generateBadgeSvg (compact badge)
Two-section badge. Width auto-sized to text. Height 20px. Adapts to system theme via `prefers-color-scheme`.
- Left section (label): `f-panel` background, `f-lbl` text
- Right section (value): CSS class based on confidence — `f-grn` (established), `f-yel` (tentative/server-estimate), `f-panel` (no-data)
- Value text: white (`fill="#fff"`) on coloured backgrounds; `f-acc` themed blue for no-data CTA
- Border: `s-bd` (themed stroke)
- Flat design; width-scoped clipPath IDs (`bg<W>c`) prevent conflicts when multiple badges share a page
- `BadgeStats`: `pkgName`, `version`, `format`, `exportCount`, `fileCount`, `roundTrips` (no `durationMs`)

### generateStandardBanner (standard banner)
Width 520px. Adapts to system theme via `prefers-color-scheme`. Two layout modes:

**Waterfall mode** (when `resources` present):
- Row 1 (28px, `f-panel` bg): `pkg@version` bold (`f-val`) + CDN/ESM/UMD pills on right
- Stats line (18px): size (`f-grn`/`f-red`/`f-lbl`) · exports · files · round trips (all `f-lbl`), separator dots `f-bd`
- Per-resource rows (13px each): filename (`f-val`, ≤18 chars), size (`f-lbl`), byte-proportional bar (CSS colour class by round trip)
- Resources grouped by pre-computed `roundTrip`; largest file first within each round
- Total height: `28 + 18 + N×13 + 5`
- Round-trip colours: `f-acc` → `f-grn` → `f-yel` → `f-red`

**Fallback mode** (no `resources`):
- Row 2 (36px): `f-bd` bar track + `sizeCls` fill bar + stats text
- Total height: 64px fixed

### generateFullBanner (full banner)
Multi-row. Width 520px, Height = 28 + N×22px. Adapts to system theme via `prefers-color-scheme`.
Header row + one row per export; alternating `f-panel`/`f-bg` row backgrounds.

### Theme CSS (`THEME_CSS` constant in svg.ts)
All SVG elements use CSS classes (`f-*` for fill, `s-*` for stroke) instead of inline colour attributes. A single `@media (prefers-color-scheme: light)` block switches the entire palette.

Dark palette (default): `#0d1117` bg / `#161b22` panel / `#30363d` border / `#8b949e` label / `#e6edf3` value / `#58a6ff` acc / `#3fb950` grn / `#d29922` yel / `#f85149` red

Light palette: `#ffffff` bg / `#f6f8fa` panel / `#d0d7de` border / `#57606a` label / `#24292f` value / `#0969da` acc / `#1a7f37` grn / `#9a6700` yel / `#cf222e` red

CSS classes: `f-bg f-panel f-lbl f-val f-bd f-acc f-grn f-yel f-red` (fill) · `s-bd s-acc s-grn s-yel s-red` (stroke)

### banner.ts — DB-only, no live measurements

**Architecture principle**: the banner is a *read-only* view of data already stored in D1.
All measurements and analysis happen in the bulk website (browser iframe → `/_record`, or
the `/_bundle` endpoint). The banner never performs live CDN requests.

Handler flow:
1. Resolves version via `resolveVersion` (D1 cache 1h, then npm registry — read-only, no writes)
2. Fetches export list via `getPackageExports` (D1 cache, read-only)
3. **Fetches latest structural waterfall** via `getLatestWaterfall(pkg, version, 'index', cdn, env)` — queries the most-recent session from `package_waterfall` table (pre-computed `round_trip` + `bytes` per resource; no timing)
4. Derives `bytes` (total) as sum of all waterfall row bytes; derives `fileCount` and `roundTrips` from the waterfall rows
5. Falls back to `getCachedSize` (server HEAD stored by `/_bundle`) if waterfall has no data yet
   - If no data at all, `bytes` remains `null` → SVG shows "—" (static, no live fetch)
   - **No live CDN HEAD requests** — the banner never calls `measureSize`
6. Passes `resources` array (mapped from waterfall rows) to `generateStandardBanner` — triggers waterfall SVG layout when data is present
7. Falls back gracefully: missing size → "—" (em dash); missing waterfall → fallback bar layout
8. Returns error banner SVG on exception (never a 5xx, always an SVG)
9. For `full` banner: uses `getMeasuredSizeFromWaterfall` per export (P50 of session totals)

**Data flow summary**:
```
User measures on bulk website
  → browser iframe records decodedBodySize → POST /_record
    → server computes round_trip from startTime gaps
    → saves to package_waterfall (round_trip, url, bytes) — no raw timing stored
  → /_bundle call → cdn_sizes table (server-side HEAD estimates)
Banner reads package_waterfall → renders structural waterfall SVG
```

**No `isOwnResource` filter in banner.ts**: waterfall rows are already filtered at ingestion time — `/_record` only saves resources with `pkg` annotation set by the client-side `isOwnResource` check in `measurement.ts`.

---

## 🗄 D1 schema
```
cdn_sizes              (package,version,export_key,cdn → bytes_raw,bytes_transfer,fetched_at)
package_exports        (package,version → exports:JSON, fetched_at)
package_versions       (package,version,published_at)
package_versions_fetched (package,fetched_at)
version_resolution     (package,version,fetched_at)
resource_timings       (package,version,export_key,cdn,browser,connection,
                         transfer_size,decoded_body_size,start_time,response_end,url,
                         timestamp DEFAULT datetime('now'))
                        ← LEGACY — no longer written to; kept for historical data only
package_waterfall      (package,version,export_key,cdn,round_trip,url,bytes,
                         recorded_at DEFAULT datetime('now'))
                        ← PRIMARY — structural dependency waterfall, no timing data
                        ← migration: migrations/0003_package_waterfall.sql
```

**`getLatestWaterfall(pkg, version, exportKey, cdn, env)`** — queries `package_waterfall` for all rows where `recorded_at = MAX(recorded_at)` (= latest measurement session). Returns `WaterfallRow[]` with `{round_trip, url, bytes}`. Used by `banner.ts` to render the waterfall SVG. Sessions share a `recorded_at` because batch INSERTs all land in the same SQLite second.

**`getMeasuredSizeFromWaterfall(pkg, version, exportKey, cdn, env)`** — P50 of per-session total decoded bytes. Requires ≥10 sessions; returns `MeasuredSize | null` with `confidence: 'established' | 'tentative'`.

---

## 🔍 discover.ts — export resolution

Parses `@scope/name@version` and `name@version` correctly.

Resolution order:
1. Fetch `https://registry.npmjs.org/<pkg>/<version>` (version can be tag like `latest`)
2. If `pkgJson.exports` present → `parseExports()` in cdn.ts
3. If NO `exports` field → scan tarball via jsDelivr flat API (`fetchPackageFiles`)
   - Filters to `.js|.mjs|.cjs` files
   - Deduplicates by stem, preferring `.mjs > .js > .cjs`
   - Returns all files as export list

Response: `{ package, version, exports: [{key, path}], wildcardResolved: boolean }`

---

## 🎛 OutputTabs — UMD detection (fetchUmdInfo)

Uses jsDelivr flat API: `https://data.jsdelivr.com/v1/package/npm/<pkg>@<ver>/flat`
**Do NOT encode** the pkg@version with encodeURIComponent — jsDelivr expects raw `@scope/name@version`.

UMD candidate priority:
1. `umd/*.production.min.js` (non-ESM)
2. `umd/*.min.js` (non-ESM)
3. `*.umd.prod.min.js`
4. `*.umd.min.js`
5. `*.umd.js`
6. `umd/*.js` (non-ESM)
7. `dist/*.global.prod.js`
8. `dist/*.production.min.js`
9. `dist/*.min.js`
10. root-level `*.min.js`

Non-ESM filter: exclude files matching `/\.(mjs|esm\.js|module\.js)$/`

---

## 📊 Waterfall component

Groups `ResourceTimingEntry[]` into rounds: resources whose `startTime` is within 5ms of the previous are in the same round; a gap > 5ms opens a new round.

Displays: total files · wire size (transferSize) · decoded size (decodedBodySize) · round count · total duration.

---

## 🎨 CSS vars (:root)
```
--color-{bg|grid|text|text-muted|accent|border|border-light}
--spacing-{page-padding|main-block|section-*|hero-*|heading-*|input-*|button-*|row-gap|label-bottom|select-pr|hairline}
--font-size-{heading|tagline|code|label|input|button|providers|base|sm} + -mobile variants
prefers-color-scheme:dark overrides all --color-*
```

### Key CSS module classes
**App.module.css**: `pkgInputWrap` `inputRow` `inputGroup` `cdnGroup` `exportGroup` `pkgInput` `cdnSelect` `exportSelect` `runBtn` `runBtnDirty` (glow anim) `revertBtn` `resultsDimmed` (opacity 0.4, pointer-events none) `results` `error` `spinnerWrap` `spinner`

**BundleHistory.module.css**: `bundleHistory` `chartWrap` `chart` `gridLine` `line` `area` `point` `pointEmpty` `pointPending` `axisLabel` `crosshair` `tooltipGroup` `tooltipBox` `tooltipVersion` `tooltipBytes` `loading` `error` `statItem` `chartFooter` `generateBtn`

**BadgeGenerator.module.css**: `badgeGenerator` `separator` (hr rule) `headingRow` (flex, space-between) `inputLabel` `previewRow` `badgeImg` `bannerImg` `copyButton`

---

## 🏗 build
```
bun run build-client.ts
  → rm public/ · mkdir public/
  → Bun.build(src/client/main.tsx, minify:true, SolidPlugin) → public/main.js + main.css
  → mkdir public/_ · mv main.css→public/_/styles.css
  → cp index.html → public/index.html · cp logo.png → public/_/logo.png
wrangler deploy  ← bundles src/index.ts + public/** → CF Workers
```

---

## 🧪 test
`bun test` · vitest + @cloudflare/vitest-pool-workers · test/index.spec.ts
Test suite is placeholder (tests /message, /random) — does NOT test actual handlers.

---

## cmds
```sh
bun run dev          # wrangler dev
bun run build:client # build-client.ts only
bun run deploy       # build:client → wrangler deploy
bun test             # vitest (needs @cloudflare/vitest-pool-workers — bun install first)
bun run cf-typegen   # wrangler types → worker-configuration.d.ts
bunx tsc --noEmit    # type-check (clean after bun install)
```

**Always use `bun` / `bunx` — never `npm`, `npx`, or `node` directly.**
`bun install` installs all devDeps including `@types/bun`; without it `tsc` errors on missing bun type defs.

---

## ∇ invariants
- `/_/` reserved namespace; npm package names never start with `_`
- Static assets `/_/` checked before API routes
- Cache key: strip `?refresh`, append `?cache_v=v3`
- localhost → skip CF cache entirely
- All cache writes & telemetry → `ctx.waitUntil` (non-blocking, best-effort)
- Export key normalisation: `.`→`index`; `./foo`→`foo`
- Wildcard exports: file list from jsDelivr flat API (`fetchPackageFiles` in wildcard.ts)
- Semver filter (version list): 3-segment only, no prerelease; max ~50 versions (1 per minor)
- `bytes_transfer` (compressed Content-Length) preferred over `bytes_raw` (GET body length)
- badge CDN = providers.ts (root pkg only); bundle CDN = cdn.ts (export-aware)
- `pkg` signal committed only on explicit user action; never on keystroke
- `/_discover` only called inside `handleMeasure`, never reactively from the input field
- esm.sh importmap URLs always use `?bundle` to prevent separate dep requests in the browser

---

## ⚠ known gaps / gotchas
- badge endpoint measures **root CDN response** (not bundled/treeshaken)
- Skypack listed in providers.ts but NOT in CDNS (cdn.ts) — badge only, no bundle analysis
- No gzip/brotli simulation: bytes_transfer = what CDN serves, not what a bundler would emit
- D1 stores indefinitely for pinned versions; no eviction/cleanup mechanism
- `LoadingOverlay.tsx` still exists as a file but is unused — App.tsx no longer imports it
- `bundle-history.ts` handler still exists but the UI no longer calls `/_bundle-history/*`; it uses `/_versions/` + per-version `/_bundle/` instead
- `tsc --noEmit` always emits one pre-existing error: "Cannot find type definition file for 'bun'" — ignore it; it does not block builds
- `?export=` URL param is no longer synced immediately on chip click (chips were removed); export is now a `<select>` driven by discover data
- **Export dropdown SolidJS quirk:** `<select value={selectedExport()}>` does NOT re-apply its value when child `<option>` elements are re-rendered by `<For>`. The fix is to skip calling `setDiscoverData(dr)` when data for the same package is already loaded — keeping the `<For>` stable and the select selection intact.
