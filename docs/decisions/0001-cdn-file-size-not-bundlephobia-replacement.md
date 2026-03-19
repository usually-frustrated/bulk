# ADR 0001 — Use CDN-served file size, not a self-hosted bundler

**Status:** Accepted
**Date:** 2026-03-19

---

## Context

We wanted to add a `/_bundle/<pkg>@<version>/<export>` endpoint that reports the
size of a specific package export — similar to what Bundlephobia shows. We also
wanted a historical graph of how that size has changed across versions.

Bundlephobia's approach: install the package locally with npm, run webpack/esbuild
to produce a tree-shaken, minified bundle, then measure the output. This gives an
accurate "cost of adding this to your app" number.

We explored two phases of architecture before reaching the final approach:

### Phase 1 — Cloudflare Containers + Bun

Run a Bun process inside a Cloudflare Container:
- `bun add <pkg>@<version>` to install
- `bun build --minify` to bundle
- Measure the output file size

**Why we dropped it:**
- Container lifecycle management is operationally heavy (cold starts, planned
  downtime windows, draining during deploys).
- Containers are stateful and harder to scale horizontally than Workers.
- To handle traffic spikes we'd need container pooling, which requires a
  Durable Object orchestrator plus a work queue — significant complexity for
  a feature that is not our core product.

### Phase 2 — esbuild-wasm in Cloudflare Workers + Cloudflare Queues

Run esbuild-wasm (V8-compatible) directly in a Worker, fetch package modules
from esm.sh (which pre-converts CJS→ESM), and measure the minified output.
Offload to a Cloudflare Queue (max_concurrency: 15, max_queue: 200) to control
throughput, track jobs in D1, and stream results to the client via SSE with a
polling fallback.

**Why we dropped it:**
- The esbuild-wasm binary is ~8 MB, adding significant Worker cold-start cost.
- The queue + Durable Object backpressure counter + D1 job table + SSE endpoint
  is ~700 lines of infrastructure for a secondary feature.
- Async job polling/SSE complicates the client beyond what the feature warrants.
- We are not Bundlephobia. Replacing it was never the stated goal.

---

## Decision

Measure the **CDN-served file size** for the requested export, fetched directly
from esm.sh. No local bundling, no queue, no WASM.

```
GET /_bundle/react@18.2.0/jsx-runtime
  → fetch https://esm.sh/react@18.2.0/jsx-runtime
  → (await res.arrayBuffer()).byteLength
  → cache result in KV (immutable for pinned versions)
  → return { package, version, export, bytes, cdn: 'esm.sh' }
```

For the history graph, fetch all representative versions (one per minor, capped
at 50) in parallel via `Promise.all`. Cache each size in KV indefinitely. Warm
requests resolve from KV in ~50 ms; cold requests complete in ~1–3 s as esm.sh
fetches run concurrently.

---

## Why esm.sh

- Returns a real ESM bundle for any npm package, converting CJS automatically.
- The file it serves is what a browser would actually parse.
- URL format maps directly to our `/<pkg>@<version>/<export>` structure.
- We already use jsDelivr for the badge endpoint; esm.sh is the right CDN for
  ESM-specific export paths.

---

## What we measure vs. what Bundlephobia measures

| | Our endpoint | Bundlephobia |
|---|---|---|
| Source | esm.sh CDN output | Locally bundled (webpack) |
| Tree-shaking | None (full module) | Yes (named export only) |
| Peer deps | Excluded by esm.sh | Excluded |
| Accuracy | "what esm.sh ships" | "what lands in your bundle" |
| Infrastructure | Worker + KV | Dedicated bundler service |

The numbers will differ. Ours are a reasonable proxy for "how big is this
module as shipped by the most popular ESM CDN", which is useful and honest.
If we later want true bundle-cost numbers, the right time to build that
infrastructure is when it becomes a core product feature, not a supporting graph.

---

## Consequences

- **Simpler:** ~150 lines of Worker code, one KV namespace, no queue, no D1,
  no WASM, no Durable Objects.
- **Deployable today:** no `wrangler d1 create`, no `wrangler queues create`,
  just `wrangler kv namespace create CACHE`.
- **Different semantics:** we display CDN file size, not bundled cost. The UI
  should label it clearly (e.g., "esm.sh module size" not "bundle size").
- **Cold history requests are slow (~1–3 s):** acceptable for a one-time
  analysis; subsequent requests are sub-100 ms from KV.
