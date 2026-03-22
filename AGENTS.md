# AGENTS

## ∑ stack
CF Worker · SolidJS · Bun · Wrangler · TypeScript · D1(SQLite) · vitest

## ⌂ layout
```
src/index.ts              ← worker entry · router (badge|bundle|history|assets)
src/types.ts              ← Env{ASSETS:Fetcher, DB:D1Database}
src/constants.ts          ← SVG: CHAR_WIDTH · PAD_X · BADGE_LABEL
src/providers.ts          ← jsdelivr(dflt)|unpkg|skypack|esm.sh → {id,name,url(pkg)}
src/handlers/
  badge.ts                ← HEAD cdn → size → SVG · CF cache · telemetry
  bundle.ts               ← /_bundle/* · single/all-exports · D1 cache
  bundle-history.ts       ← /_bundle-history/* · all versions → sizes → JSON
src/utils/
  pkg.ts                  ← parsePath · buildCacheControl · isImmutableVersion
  svg.ts                  ← generateBadgeSvg(label,val,isErr)→SVG string
  size.ts                 ← formatSize(bytes)→"1.2 kB"
  cdn.ts                  ← buildCdnUrl · measureSize(HEAD→GET fallback) · parseExports
  db.ts                   ← resolveVersion · getPackageExports · getCachedSize · saveSize
  telemetry.ts            ← Telemetry.{info|warn|error|logAsync}
  bundle-parse.ts         ← parseBundlePath("/_bundle/<pkg>[@ver][/export]")
src/client/
  main.tsx                ← SolidJS mount → #root
  App.tsx                 ← state(pkg,cdn,loading) · Header|ExportsTable|BundleHistory|Footer
  style.css               ← reset + CSS vars (light/dark) + layout
  index.html              ← links /_/styles.css · loads /main.js
  components/
    Header.tsx            ← title + logo
    ExportsTable.tsx      ← fetch npm registry → badge URLs · copy-to-clipboard
    BundleHistory.tsx     ← SVG line chart · tooltip · calls /_bundle-history/*
    Footer.tsx            ← links/credits
    LoadingOverlay.tsx    ← shown during fetch
    BadgeGenerator.tsx    ← badge URL input/display
    UsageInfo.tsx         ← usage docs
migrations/0001_bundle_schema.sql ← D1 schema (5 tables)
build-client.ts           ← Bun.build(main.tsx,minify,SolidPlugin)→public/
wrangler.jsonc            ← main=src/index.ts · assets=./public · D1 binding · observability
```

## ⇒ routing (src/index.ts)
```
/favicon.ico          → 404
/_/*                  → env.ASSETS.fetch(request)   [static; auto MIME; no badge logic]
/_bundle-history/*    → handleBundleHistory
/_bundle/*            → handleBundleRequest
*                     → handleBadgeRequest
```

## 🏷 badge flow
```
URL → parsePath(pathname) → {provider,pkg} | null→redirect /
→ CF cache check (key=url?cache_v=v3; skip if localhost|?refresh)
→ fetchPackageSize: HEAD cdn url → content-length | GET→byteLen
→ generateBadgeSvg(label,sizeStr,isErr) → SVG
→ Response(svg, Content-Type:image/svg+xml, Cache-Control, ACAO:*)
→ ctx.waitUntil(cache.put)  [non-blocking]
```
Cache TTL: 1yr if version pinned (`/\d/` test on semver segment) else 1h

## 📦 bundle flow
```
/_bundle/<pkg>[@ver][/<export>]?cdn=esm.sh&exports
→ parseBundlePath → {package,version,exportPath}
→ resolveVersion("latest"→npm registry, cached 1h in D1)
→ getPackageExports → npm registry pkgjson → parseExports()
→ per export: D1 cache hit? return. else buildCdnUrl→measureSize→saveSize(ctx.waitUntil)
→ Response.json({package,version,cdn,exports:[{key,bytes_raw,bytes_transfer}]})
```

## 📈 bundle-history flow
```
/_bundle-history/<pkg>[/<export>]?cdn=esm.sh
→ all npm versions (cached 24h) → filter ≤50 (1 per minor, 3-seg semver only, no pre)
→ per version: D1 hit? use. else CDN fetch → parallel Promise.all
→ Response.json({package,export,cdn,versions:[{version,publishedAt,bytes_transfer,bytes_raw}]})
```

## 🌐 CDN url patterns
| cdn | root | subpath |
|-----|------|---------|
| esm.sh | `esm.sh/<pkg>@<ver>` | `esm.sh/<pkg>@<ver>/<key>` |
| jsdelivr | `cdn.jsdelivr.net/npm/<pkg>@<ver>/+esm` | `cdn.jsdelivr.net/npm/<pkg>@<ver>/<file>` |
| unpkg | `unpkg.com/<pkg>@<ver>` | `unpkg.com/<pkg>@<ver>/<file>` |

## 📐 size measurement strategy
```
HEAD → Content-Length present → bytes_transfer (compressed, preferred)
HEAD → no Content-Length (chunked) → GET → body.byteLength → bytes_raw
       + check GET Content-Length too → bytes_transfer if present
```

## 🗄 D1 schema (5 tables)
```
cdn_sizes              (package,version,export_key,cdn → bytes_raw,bytes_transfer,fetched_at)
package_exports        (package,version → exports:JSON, fetched_at)
package_versions       (package,version,published_at)
package_versions_fetched (package,fetched_at)
version_resolution     (package,version,fetched_at)
```

## 🏗 build
```
bun run build-client.ts
  → rm public/ · mkdir public/
  → Bun.build(src/client/main.tsx, minify:true, SolidPlugin) → public/main.js + main.css
  → mkdir public/_ · mv main.css→public/_/styles.css
  → cp index.html → public/index.html · cp logo.png → public/_/logo.png
wrangler deploy  ← bundles src/index.ts + public/** → CF Workers
```

## 🔌 CF bindings
```
env.ASSETS : Fetcher   — static assets · auto MIME · ETags · range
env.DB     : D1Database — SQLite via Cloudflare D1
```

## 🎨 CSS vars (:root)
`--color-{bg|grid|text|text-muted|accent|border|border-light}`
`--spacing-{page-padding|main-block|section-*|hero-*|heading-*|input-*|button-*}`
`--font-size-{heading|tagline|code|label|input|button|providers}` + `-mobile` variants
`prefers-color-scheme:dark` overrides all `--color-*`

## 🧪 test
`bun test` · vitest + @cloudflare/vitest-pool-workers · test/index.spec.ts

## cmds
```sh
bun run dev          # wrangler dev
bun run build:client # build-client.ts only
bun run deploy       # build:client → wrangler deploy
bun test
bun run cf-typegen   # wrangler types → worker-configuration.d.ts
```

## ∇ invariants
- `/_/` reserved namespace; npm package names never start with `_`
- Cache key: strip `?refresh`, append `?cache_v=v3`
- localhost → skip CF cache entirely
- All cache writes & telemetry → `ctx.waitUntil` (non-blocking, best-effort)
- Export key normalisation: `.`→`index`; `./foo`→`foo`
- Wildcard exports: client crawls unpkg `/?meta` for file discovery
- Semver filter: 3-segment only, no prerelease; max ~50 versions (1 per minor)
- `bytes_transfer` (compressed HEAD Content-Length) preferred over `bytes_raw` (GET body)
- badge CDN = providers.ts (root pkg only); bundle CDN = cdn.ts (export-aware)

## ⚠ known gaps / gotchas
- badge endpoint measures **root CDN response** (not bundled/treeshaken) — good for CDN cost, not bundle impact
- Skypack (cdn.skypack.dev) listed in providers but NOT in CDNS (cdn.ts) — badge only, no bundle analysis
- No gzip/brotli simulation: bytes_transfer = what CDN serves, not what bundler would emit
- D1 stores indefinitely for pinned versions; no eviction / cleanup mechanism
- test suite is placeholder (tests /message, /random) — not testing actual handlers
