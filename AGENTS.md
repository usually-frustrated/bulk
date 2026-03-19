# AGENTS

## ∑ stack
CF Worker · SolidJS · Bun · Wrangler · TypeScript · vitest

## ⌂ layout
```
src/index.ts          ← worker entry / router
src/types.ts          ← Env{ASSETS:Fetcher}
src/providers.ts      ← jsdelivr(dflt)|unpkg|skypack|esm.sh → CDN url fns
src/handlers/badge.ts ← fetch pkg size → SVG · CF cache · telemetry
src/utils/
  pkg.ts              ← parsePath · buildCacheControl
  svg.ts              ← generateBadgeSvg
  size.ts             ← formatSize
  telemetry.ts        ← Telemetry.{info|warn|error|logAsync}
src/client/
  main.tsx            ← SolidJS mount
  App.tsx             ← <main><hero-section> Header|UsageInfo|BadgeGenerator
  style.css           ← global CSS reset + CSS vars (light/dark) + layout
  index.html          ← links /_/styles.css · loads /main.js
  components/         ← Header · Footer · UsageInfo · BadgeGenerator (CSS modules)
build-client.ts       ← bun build main.tsx→public/ · mv main.css→public/_/styles.css · cp index.html
public/               ← build artifact (gitignored-ish) · CF assets dir
wrangler.jsonc        ← main=src/index.ts · assets.dir=./public · build.cmd=bun run build-client.ts
```

## ⇒ routing  (src/index.ts)
```
/favicon.ico          → 404
/_/*                  → env.ASSETS.fetch(request)  [static; MIME auto; no badge logic]
*                     → handleBadgeRequest(request, ctx)
```

## ⚙ badge flow
`parsePath(pathname)` → `{provider,pkg}` | null→redirect /
→ CF cache check (key=url+cache_v=v3, skip if localhost|?refresh)
→ `fetchPackageSize(provider,pkg)` → HEAD cdn url → content-length | download→byteLen → formatSize
→ `generateBadgeSvg(label,val,isErr)` → SVG string
→ Response(svg, {Content-Type:image/svg+xml, Cache-Control, ACAO:*})
→ cache.put (non-blocking via ctx.waitUntil)

## 🏗 build
`bun run build-client.ts`
→ rm public/ · mkdir public/
→ Bun.build(main.tsx, minify, SolidPlugin) → public/main.js + public/main.css
→ mkdir public/_ · mv main.css → public/_/styles.css
→ cp src/client/index.html → public/index.html

## 🔌 CF bindings
`env.ASSETS` : Fetcher — Cloudflare static assets · serves public/** · auto MIME · ETags · range

## providers (src/providers.ts)
| id | name | url pattern |
|----|------|------------|
| jsdelivr | jsDelivr | cdn.jsdelivr.net/npm/:pkg |
| unpkg | unpkg | unpkg.com/:pkg |
| skypack | Skypack | cdn.skypack.dev/:pkg |
| esmsh | esm.sh | esm.sh/:pkg |
default=jsdelivr

## 🎨 CSS vars (:root)
--color-{bg|grid|text|text-muted|accent|border|border-light}
--spacing-{page-padding|main-block|section-*|hero-*|heading-*|input-*|button-*}
--font-size-{heading|tagline|code|label|input|button|providers} + *-mobile variants
dark: prefers-color-scheme:dark overrides

## 🧪 test
vitest · @cloudflare/vitest-pool-workers · test/index.spec.ts

## cmds
```sh
bun run dev        # wrangler dev
bun run build:client
bun run deploy     # wrangler deploy
bun test
bun run cf-typegen # wrangler types → worker-configuration.d.ts
```

## ∇ key invariants
- `/_/` namespace reserved for static assets; npm paths never start with _
- CSS compiled path: public/_/styles.css ↔ /_/styles.css request
- Cache key strips ?refresh, appends ?cache_v=v3
- localhost skips CF cache entirely
- All telemetry/cache writes → ctx.waitUntil (non-blocking)
