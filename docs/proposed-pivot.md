# bulk — proposed pivot
> captured from design session, 2026-03-22

---

## 1. what bulk is today

A Cloudflare Worker that generates SVG shield-style badges showing CDN file sizes for npm packages. A developer embeds `![](https://bulk.dev/react)` in their README and gets a badge like `jsDelivr size: 45 kB`.

**How it measures today:**
- `GET /react` → `HEAD https://cdn.jsdelivr.net/npm/react` → read `Content-Length` → render SVG
- `GET /_bundle/react@18.3.1/jsx-runtime` → HEAD CDN export URL → size → JSON + D1 cache
- `GET /_bundle-history/react` → fetch all versions, measure each, store in D1, return for chart

**Tech stack:** CF Workers · SolidJS · Bun · TypeScript · D1 (SQLite) · Wrangler
**Client:** SolidJS SPA — package input → exports table + badge URLs + version history SVG chart

---

## 2. the original questions that started this session

> *"What will it cost me to make this library external?"*

Reframed correctly: a developer working on a web app asks — if I move this npm dependency from being bundled by my build tool to being loaded via a `<script type="module">` / importmap from a CDN, **what does that actually cost my users?**

Sub-questions:
- What URL should I use to externalize this module?
- Do I get a bundled or non-bundled file from this CDN?
- What is the network waterfall? How many sequential round trips?
- What is the total network download cost, parse size cost?
- What are all the valid export paths for this package?
- How many importmap entries do I need?

---

## 3. the fatal flaw we discovered

We fact-checked the current measurements by making real HTTP requests. **The badge numbers are wrong.**

### esm.sh root URL
```
HEAD https://esm.sh/react-dom@18.3.1
→ content-length: 238
→ x-esm-path: /react-dom@18.3.1/es2022/react-dom.mjs
```
The 238 bytes is a **re-export wrapper**:
```js
/* esm.sh - react-dom@18.3.1 */
import "/react@18.3.1/es2022/react.mjs";
import "/scheduler@^0.23.2?target=es2022";
export * from "/react-dom@18.3.1/es2022/react-dom.mjs";
export { default } from "/react-dom@18.3.1/es2022/react-dom.mjs";
```
Bulk shows `238 B` for react-dom on esm.sh. The actual download is ~140 kB+ across multiple files.

### jsDelivr root URL (no `/+esm`)
```
HEAD https://cdn.jsdelivr.net/npm/react-dom@18.3.1
→ content-length: 782
→ module.exports = require("./cjs/react-dom.production.min.js")
```
**CJS code.** Won't execute in a browser `<script type="module">` without a module bundler. Bulk shows `782 B`. Meaningless.

### esm.sh `?bundle` flag — also NOT a single file
```
esm.sh/react-dom@18.3.1?bundle
→ 209 byte wrapper → react-dom.bundle.mjs (136 kB)
   still imports: /react@18.3.1/es2022/react.mjs  ← separate request
```
Even `?bundle` does not produce a truly self-contained file. It inlines scheduler but keeps react as a separate ESM import.

### jsDelivr `/+esm` — the real ESM entry
```
https://cdn.jsdelivr.net/npm/react-dom@18.3.1/+esm
→ content-length: 132,539
→ import e from"/npm/react@18.3.1/+esm";
→ import n from"/npm/scheduler@0.23.2/+esm";
```
132 kB with its own waterfall to react + scheduler. Not what bulk measures at all.

### conclusion
The `/_bundle` endpoint has the same problem for root/index exports on esm.sh: `buildCdnUrl` for `isRoot` returns `https://esm.sh/${pkg}@${version}` — the 238-byte wrapper.

**No CDN serves a truly self-contained single file by default for packages with peer deps. Both esm.sh and jsDelivr have waterfalls.**

---

## 4. the three export models

Discovered by inspecting real packages:

### model A — single root (redux)
```json
".": { "import": "./dist/redux.mjs" }
```
One URL. Simple. No subpaths.

### model B — explicit named subpaths (@reduxjs/toolkit)
```json
".":             → dist/redux-toolkit.modern.mjs
"./react":       → dist/react/redux-toolkit-react.modern.mjs
"./query":       → dist/query/rtk-query.modern.mjs
"./query/react": → dist/query/react/rtk-query-react.modern.mjs
```
Package author explicitly declares public subpath API. Enumerable. CDNs know how to route these.

### model C — wildcard (zustand)
```json
"./*": { "import": "./esm/*.mjs" }
```
`zustand/middleware`, `zustand/react`, `zustand/vanilla`, `zustand/shallow`, etc. — all valid. Cannot be enumerated from exports field alone. Must either:
- crawl the npm file listing (unpkg `/?meta` hack — returns every file, not just public API)
- load what the user actually imports and let the browser report what resolved

---

## 5. the cross-subpath deduplication problem

When your app uses **multiple subpaths of the same package**, CDNs may or may not deduplicate shared code.

### jsDelivr — deduplicates by exact URL
```
@reduxjs/toolkit@2.11.2/+esm          (23 kB) ← your importmap entry
  └─ imports redux, immer, reselect

@reduxjs/toolkit@2.11.2/query/react/+esm (14 kB) ← your importmap entry
  └─ imports @reduxjs/toolkit@2.11.2/+esm    ← SAME URL → browser fetches once
  └─ imports react-redux
       └─ imports react
```
jsDelivr's `@reduxjs/toolkit/+esm` is imported by `query/react/+esm` as the same URL → deduplicated.

### esm.sh — wrapper URL ≠ .mjs URL → potential double-fetch
```
esm.sh/@reduxjs/toolkit              ← your importmap entry (wrapper, re-exports toolkit.mjs)
esm.sh/@reduxjs/toolkit/query/react  ← your importmap entry (wrapper)
  └─ imports /@reduxjs/toolkit@2.11.2/es2022/toolkit.mjs   ← DIFFERENT URL than wrapper above
```
The wrapper URL and the `.mjs` URL are distinct. Whether the browser deduplicates depends on load ordering and whether both chains resolve before either fires the fetch. **This is not theoretical — real apps can double-download in certain load orders on esm.sh.**

---

## 6. the correct question: importmap, not badge

What a developer actually needs when externalising `@reduxjs/toolkit/query/react` is not a size badge. It's:

```json
{
  "imports": {
    "@reduxjs/toolkit":             "https://cdn.jsdelivr.net/npm/@reduxjs/toolkit@2.11.2/+esm",
    "@reduxjs/toolkit/react":       "https://cdn.jsdelivr.net/npm/@reduxjs/toolkit@2.11.2/react/+esm",
    "@reduxjs/toolkit/query":       "https://cdn.jsdelivr.net/npm/@reduxjs/toolkit@2.11.2/query/+esm",
    "@reduxjs/toolkit/query/react": "https://cdn.jsdelivr.net/npm/@reduxjs/toolkit@2.11.2/query/react/+esm",
    "react-redux":                  "https://cdn.jsdelivr.net/npm/react-redux@9.2.0/+esm",
    "react":                        "https://cdn.jsdelivr.net/npm/react@18.3.1/+esm",
    "react-dom":                    "https://cdn.jsdelivr.net/npm/react-dom@18.3.1/+esm",
    "redux":                        "https://cdn.jsdelivr.net/npm/redux@5.0.1/+esm",
    "immer":                        "https://cdn.jsdelivr.net/npm/immer@11.0.1/+esm",
    "reselect":                     "https://cdn.jsdelivr.net/npm/reselect@5.1.1/+esm"
  }
}
```

Including transitive peer deps. These are discovered by actually loading the files, not by guessing from package.json `peerDependencies` (which is often wrong or incomplete).

---

## 7. the pivot: browser as measurement instrument

### the core insight
The browser already has the perfect instrument: `PerformanceResourceTiming`. When the browser loads a module, every sub-request in the waterfall gets a timing entry:

```
entry.name             → the actual URL fetched
entry.transferSize     → bytes over the wire (compressed)
entry.encodedBodySize  → compressed size
entry.decodedBodySize  → uncompressed / parse cost
entry.startTime        → when request started
entry.responseEnd      → when it finished
entry.initiatorType    → 'script' | 'fetch' | etc.
```

This gives us — for free, from a real browser on a real network:
- the complete waterfall (every URL, in order, with timing)
- which fetches were parallel vs sequential (gap between `startTime` values)
- actual wire size vs parse size (not a HEAD request guess)
- deduplication reality (if a URL appears once, browser deduplicated it)

### what changes
| | today | after pivot |
|---|---|---|
| who measures | our server (HEAD requests to CDN) | the user's browser (Performance API) |
| what is measured | root CDN URL Content-Length | every file actually loaded |
| server role | measurer | recorder + aggregator |
| primary output | SVG badge (one number) | waterfall + importmap + badge |
| badge data | HEAD Content-Length (wrong) | crowd-sourced real browser data |

### the new core loop
1. user types package names + subpaths they use: `@reduxjs/toolkit`, `@reduxjs/toolkit/query/react`
2. bulk UI builds an importmap and dynamically loads all of them in a sandboxed iframe
3. reads `iframe.contentWindow.performance.getEntriesByType('resource')`
4. renders waterfall chart, totals, importmap output
5. POSTs measurement to `/_record` endpoint → stored in D1
6. over time: aggregated P50/P90 by browser type + network condition

### what the output looks like
```
@reduxjs/toolkit + /query/react  ·  jsDelivr  ·  Chrome/133  ·  broadband
──────────────────────────────────────────────────────────────────────────
8 files  ·  214 kB wire  ·  680 kB parsed  ·  3 sequential round trips

Round 1  (0 ms)
  @reduxjs/toolkit/+esm         23 kB  ┐ parallel
  @reduxjs/toolkit/query/react   14 kB  ┘

Round 2  (+45 ms)
  react-redux/+esm               18 kB  ┐ parallel
  redux/+esm                     12 kB  │
  immer/+esm                     22 kB  │
  reselect/+esm                   8 kB  ┘

Round 3  (+90 ms)
  react@18.3.1/+esm              87 kB  ┐ parallel
  scheduler@0.23.2/+esm          30 kB  ┘

Importmap ↓
{ "@reduxjs/toolkit": "...", "@reduxjs/toolkit/query/react": "...", ... }
```

### the badge (still useful, now honest)
```
@reduxjs/toolkit/query/react · jsDelivr · 8 files · 214 kB · 3 hops
```
Derived from real browser measurements, not HEAD request guessing.

---

## 8. the wildcard exports problem — solved by the browser approach

Wildcard exports (`"./*"` in package.json) cannot be enumerated statically. But with the browser approach, this is no longer a blocker:

- user says "I use `zustand/middleware` and `zustand/vanilla`"
- bulk loads exactly those
- Performance API reports exactly what files were fetched
- importmap is derived from the fetched URLs, not from guessing the exports field

The wildcard case disappears as a special case. The browser resolves it naturally.

---

## 9. module format diversity — "how many script tags" is not the wrong question

The earlier framing ("importmap is the answer, script tags are the wrong question") was too narrow. Externalization happens in multiple formats, and each has a completely different cost model. bulk should be inclusive of all of them.

### the formats

**UMD / IIFE — `<script src="...">` + global variable**

The classic CDN approach. No importmap, no module system required. Works in any browser, any era.

```html
<script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
```

Bundler config:
```js
externals: { 'react': 'React', 'react-dom': 'ReactDOM' }
```

For UMD, "how many script tags" is *exactly* the right question. Key facts verified:

| package | UMD available? | size | depends on global |
|---|---|---|---|
| react@18.3.1 | ✅ | 10,751 bytes | none |
| react-dom@18.3.1 | ✅ | 131,835 bytes | `window.React` |
| redux@5.0.1 | ✅ (dist/redux.min.js) | — | none |
| @reduxjs/toolkit@2.11.2 | ❌ no UMD in dist | — | — |
| zustand@5.0.12 | ❌ no UMD at all | — | — |

**RTK and zustand cannot be externalised via script tags.** They ship ESM + CJS only. If a developer tries to follow the "add a script tag from a CDN" pattern, it doesn't exist for these packages. This is something bulk could surface immediately and clearly rather than silently returning wrong data.

Script tag ordering is a hard constraint for UMD: each file depends on globals set by previous files. `react-dom` must come after `react` because it calls `window.React`. The "waterfall" for UMD is not network-parallel — it's sequential by definition (browsers execute `<script>` tags in DOM order, each synchronously blocks the next). The cost model is completely different from ESM module graphs.

**ESM via importmap**

Covered extensively above. Multiple files, parallel fetches within a level, importmap needed for bare specifiers, transitive peer deps must be covered.

**ESM via explicit URLs in source**

```js
import { create } from 'https://esm.sh/zustand@5.0.12/react'
```

No importmap needed. The URL is hardcoded in source. This works but couples source code to a specific CDN and version URL. Less common in production apps, but used in quick prototypes and Deno/browser-native contexts. The waterfall cost is identical to importmap ESM — the resolution mechanism just differs.

**CJS (Node.js / SSR)**

`require('react')` — not for the browser directly, but relevant for SSR contexts (Next.js pages, Remix loaders, etc.) where you might want to externalize from a server bundle. Different CDN story: you'd use a package registry or a dedicated server-side CDN, not jsDelivr/esm.sh. Out of scope for the browser lab, but relevant for CLI/API consumers of bulk.

**AMD (RequireJS)**

Legacy. Still exists in enterprise apps. `define(['react'], function(React) {...})`. CDNs serve the raw files; AMD loader resolves them. Effectively a script-tag model with a runtime loader on top. Not a priority but "how many script tags" still applies.

### what this means for bulk's UI

The entry point question should be: **what format are you targeting?**

- **Script tags (UMD/IIFE)**: show which packages have UMD builds, their sizes, required load order, the global variable names, and explicit warning when a package has no UMD build
- **ESM importmap**: show the waterfall, importmap JSON, total files + sizes
- **ESM explicit URL**: same output as importmap but formatted as `import` statements
- **Node.js externals**: different surface, lower priority

Bulk should not assume ESM-first. A developer targeting legacy browser support or using a pre-ESM build pipeline may specifically need UMD. The "cost" question is just as real for them — and the answer (sequential script tags, global variable conflicts, no tree-shaking ever) is actually harder to find than the ESM answer.

### the browser lab still applies to UMD

UMD files loaded via `<script>` appear in `PerformanceResourceTiming` with `initiatorType: 'script'`. The browser records them too. A UMD waterfall would show:

```
Round 1  (0 ms)     react.production.min.js     10 kB   (blocking)
Round 2  (+12 ms)   react-dom.production.min.js 132 kB  (blocking, waits for round 1)
```

Sequential by necessity — that IS the UMD cost model. The measurement approach stays the same; only the load mechanism and output format change.

---

## 10. open technical questions before building

**`Timing-Allow-Origin`**: `PerformanceResourceTiming` only gives `transferSize`/`decodedBodySize` for cross-origin resources if the CDN sends `Timing-Allow-Origin: *`. jsDelivr sends it. esm.sh needs verification. Without it: we still get URLs and timing, but not byte sizes. Fallback: proxy through our Worker (adds TAO headers) — acceptable for size measurement, distorts latency.

**Sandboxing the iframe**: same-origin iframe (served from our domain via a blob URL or srcdoc) lets us read its performance entries. Cross-origin iframe does not. Loading from a blob URL or srcdoc means the importmap needs absolute URLs (which we'd have anyway).

**Module loading errors**: some packages don't work without specific peer deps already present. Need graceful handling — partial waterfall + error annotation.

**`?bundle` vs default on esm.sh**: esm.sh's default is the wrapper (tiny). `?bundle` inlines some deps but not all. Both are valid measurement targets — they represent different externalisation strategies. UI could offer the choice.

---

## 11. what stays the same

- Cloudflare Workers + D1 + Wrangler — infra stays
- SolidJS client — stays
- SVG badges for README embedding — stays, better data
- The historical version chart concept — stays, now with real measurement data
- Clean minimal aesthetic — stays
- The `/_bundle` JSON API as a read endpoint for aggregated data — stays and improves
- Multi-CDN comparison — stays, becomes a first-class side-by-side view

---

## 12. what the new write endpoint looks like

```
POST /_record
{
  "packages": ["@reduxjs/toolkit", "@reduxjs/toolkit/query/react"],
  "cdn": "jsdelivr",
  "browser": "Chrome/133",
  "connection": "4g",                   // navigator.connection.effectiveType
  "resources": [
    {
      "url": "https://cdn.jsdelivr.net/npm/@reduxjs/toolkit@2.11.2/+esm",
      "transferSize": 23148,
      "decodedBodySize": 89000,
      "startTime": 0,
      "responseEnd": 45,
      "initiatorType": "script"
    },
    ...
  ]
}
```

Server stores in D1, aggregates over time. Badges and history charts read from aggregated data.

---

## 13. the runtime chaos — why clarity is the core value

Everything we discovered in this session points to one underlying problem: **runtime library usage is genuinely, structurally chaotic**, and no tool currently cuts through it.

### the chaos, enumerated

**Package authors make inconsistent choices:**
- react ships UMD + CJS + ESM
- @reduxjs/toolkit ships CJS + ESM, no UMD
- zustand ships CJS + ESM, no UMD, wildcard exports only
- redux ships CJS + ESM, no UMD, single root export
- same ecosystem, four completely different runtime profiles
- a package can silently drop a format between minor versions

**CDNs interpret the same package differently:**
- `esm.sh/react-dom` → 238-byte re-export wrapper (not the code)
- `jsdelivr/npm/react-dom` → 782-byte CJS stub (won't run in browser)
- `jsdelivr/npm/react-dom/+esm` → 132 kB ESM with its own import chain
- `unpkg.com/react-dom` → redirects to CJS
- same package, four CDNs, four completely different responses, none of them obviously "right"

**The exports field is not a reliable map:**
- explicit named subpaths → enumerable, predictable
- wildcard `./*` → valid paths unknown without file crawl
- no exports field at all → CDN guesses from `main`/`module`/`browser` priority
- exports conditions (`browser`, `import`, `module`, `default`) → CDN may pick a different condition than your bundler does

**Peer deps are invisible until they aren't:**
- loading `@reduxjs/toolkit/query/react` silently pulls in react-redux, immer, reselect, react, scheduler
- none of these are in your importmap until the browser errors
- you discover them one 404 at a time

**Deduplication is URL-exact and fragile:**
- two different URL shapes for the same code = downloaded twice
- esm.sh wrapper URL ≠ esm.sh .mjs URL even for the same package
- ordering of parallel loads affects whether dedup happens

**The format you need may not exist:**
- RTK cannot be a script tag. Period. No UMD.
- zustand cannot be a script tag. No UMD.
- if your target environment or legacy support requires UMD and the package doesn't ship it, you're blocked — and no tool tells you this upfront

**Version changes break all of the above silently:**
- a package can change its exports map in a patch release
- a CDN can change which file it resolves to
- a peer dep can bump a major version and break dedup
- nothing monitors this for you

### why this matters for runtime optimization

Build-time optimization is well-understood and well-tooled:
- webpack-bundle-analyzer, vite visualizer, rollup-plugin-visualizer → show what's in your bundle
- BundlePhobia → shows what adding a package costs your bundled output
- tree-shaking, code splitting, dynamic imports → all build-time concerns

**Runtime optimization has no equivalent tooling.** The questions that matter at runtime:
- will this load as one file or cascade into ten?
- how many sequential round trips before the library is usable?
- does externalising this actually save my users anything, or just move bytes around?
- if I externalise to two different CDNs for two different packages, do shared deps get duplicated?
- what is the right importmap / script tag order for my specific combination of libraries?

These are not answered by any existing tool. They require actually loading the code in a browser, on a network, and observing what happens.

### clarity as the core value

**bulk's job is to be the tool that makes runtime library cost legible.**

Not an estimate. Not a simulation. Not a HEAD-request guess. The real thing — what a browser, on a given network, with a given set of packages, actually downloads and executes.

This means:
- showing format availability upfront ("this package has no UMD — script tags won't work")
- showing which CDN URL actually gives you the real code vs a wrapper or CJS stub
- showing the complete waterfall including transitive fetches you didn't ask for
- showing deduplication reality when multiple packages share deps
- generating the exact importmap or script tag list that works, derived from observation not guessing
- making this repeatable, comparable across CDNs, and trackable over versions

The badge is a distillation of all of this into a single embeddable signal. But the clarity lives in the full picture.

---

## 14. north star

> **bulk is the missing lens for runtime performance: it shows exactly what a browser pays to load a library, in whatever format and from whatever CDN, with no guessing.**

Primary output: waterfall + importmap or script tag list, generated from real browser measurement.
Badge: compressed summary of that data, honest and embeddable.
History chart: how that cost has changed across versions.
Crowd-sourced data: measurements improve with every user, across browsers and network conditions.

Differentiated from:
- **BundlePhobia** — answers bundler cost (build-time). bulk answers CDN cost (runtime).
- **Badge services** — show one number from a HEAD request. bulk shows what actually loads.
- **CDN docs** — explain their own format. bulk compares across CDNs and explains the differences.
- **DevTools Network tab** — shows one session. bulk aggregates, historicises, and makes it shareable.
