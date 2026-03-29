<div align="center">

# ✜ bulk

**CDN bundle size analysis**

</div>

---

## What it does

Measures the real browser load cost of importing a package from a CDN — how many files are fetched, how many round trips are needed, and the total decoded size. Runs an actual browser load and captures the resource waterfall.

---

## Banner SVG

Embeddable SVG that shows the package waterfall: file count, total size, and round-trip structure. Generated server-side from browser-measured data stored in D1.

```
/_banner/standard/:package[@version]
/_banner/standard/:package[@version]?cdn=esm.sh
```

**Example:**

![react-router-dom waterfall](https://bulk.frustrated.dev/_banner/standard/react-router-dom?cdn=esm.sh)

```markdown
![react-router-dom waterfall](https://bulk.frustrated.dev/_banner/standard/react-router-dom?cdn=esm.sh)
```

The banner auto-updates as new measurements are recorded. Cached at the edge and purged on write.

---

## Badge API

Small size badge (still available as a public API endpoint):

```
/:package[@version][?cdn=jsdelivr|unpkg|esm.sh]
```

**CDN:** jsdelivr (default), unpkg, esm.sh — selected via `?cdn=` query param

---

## How measurement works

1. Browser loads the package in a hidden iframe via the selected CDN
2. `PerformanceResourceTiming` entries are captured and annotated
3. Resources are grouped into round trips using the 5 ms gap heuristic
4. The structural waterfall (round trip index, URL, decoded bytes) is posted to `/_record` and stored in D1
5. The banner SVG is generated from the stored waterfall on demand

---

## Deployment

Runs on Cloudflare Workers + D1.

```bash
bun install
bunx wrangler deploy
bunx wrangler d1 migrations apply bulk-bundle --remote
```
