# Design Decisions

A living record of architectural choices, their motivation, and what they mean for the project.
Each decision is written at the time it was made so the reasoning doesn't get lost.

---

## 1. Real browser measurement over server HEAD requests

**Decision:** Measure bundle sizes by loading packages inside a hidden same-origin iframe using
a native ES importmap, then reading `performance.getEntriesByType('resource')` from the
iframe's `contentWindow`.

**Why not server HEAD requests?**
The existing approach of doing a `HEAD` (or `GET`) from the Cloudflare Worker is fundamentally
unreliable:
- esm.sh returns a tiny wrapper (~238 B) instead of the real bundle
- jsDelivr sometimes returns CJS stubs when you request the bare package path
- CDN responses to server requests may bypass client-side negotiation (compression, ESM
  rewriting, etc.)

A real browser fetch through the CDN reflects exactly what end-users download: real transfer
sizes, real Content-Encoding, real ESM rewrites, transitive dependency chains.

**What it means:**
- `transferSize` from the Performance API = wire bytes (compressed)
- `decodedBodySize` = parsed bytes (uncompressed) — the more honest "size" for developer tools
- The waterfall gives you round-trip structure (how many sequential fetches a package requires)
- Server HEAD measurements become a **fallback** when no browser data exists yet, not the
  primary source of truth

---

## 2. Crowd-sourced validation — Wikipedia model

**Decision:** Measurements below a threshold are displayed as **tentative**. Only once enough
independent sessions have measured the same (package, version, export, CDN) combination does
the data become **established**.

**Thresholds (provisional):**
| Count | Status | Behaviour |
|---|---|---|
| 0–9 | unverified | shown in UI with caveat; not used in badge or API response |
| 10–39 | tentative | shown with count indicator; used as soft estimate |
| 40+ | established | treated as authoritative P50; used in badge and API |

**Why 40?**
The median is statistically stable once you have ~40 samples. Below that, a coordinated
attacker submitting ~20 fake measurements can shift the median. At 40+ honest measurements,
you'd need 20+ coordinated fakes — more effort than this data is worth to anyone.

**Why crowd-sourcing instead of proof-of-work?**
Cryptographic proof-of-work is operationally complex (challenge keys, expiry, verification
latency) and brittle. Crowd-sourcing is self-healing: bad data from one source gets drowned
out as honest traffic accumulates. It also aligns with how the best public datasets work
(OSM, Wikipedia, Wikidata).

**What it means:**
- The `resource_timings` table grows organically. Niche packages start tentative.
- The badge and `/_bundle` API response include a `confidence` field: `"established"`,
  `"tentative"`, or `"server-estimate"` (HEAD-based fallback).
- Users trust the data more when they see it's based on N real browser measurements.

---

## 3. Client identity = SHA-256 of the rendered DOM

**Decision:** Before posting to `/_record`, the client computes:

```
clientHash = SHA-256(document.documentElement.outerHTML)
```

taken **after** measurement results have rendered in the DOM (waterfall, sizes, export list).

**Why the rendered DOM, not the static HTML?**
The static `index.html` is the same for every visitor. The rendered DOM is specific to a
measurement session: it includes the package name and version that was resolved, the actual
waterfall bars with real timing numbers, the file sizes, the importmap that was generated.
To forge a valid hash you'd have to reconstruct a DOM that matches what our app renders for
a given package — which means running the app.

**What it means:**
- The hash is a **content-addressed fingerprint** of a specific measurement session.
- It acts as a **deduplication key**: five POST requests sharing the same hash came from
  the same rendering session — count them as one independent measurement, not five.
- It is the **unit of invalidation**: if we discover a session was malicious or buggy,
  we mark that hash `suspect` and all its rows are excluded from medians at once.
- The hash also shifts as the app is redeployed (the DOM includes the content-hashed JS
  bundle URL), so you can identify and invalidate data from a specific build version.

**Server spot-check (async):**
The server cannot re-render a browser DOM, but it can validate the *claim* encoded in the
hash. For a given `client_hash`, it picks one reported `(pkg, version, export, cdn)` row,
HEAD-requests the CDN URL, and checks whether the reported `transfer_size` is within a
tolerance band (~±20%). If it passes: mark the hash `verified`. If it fails: `suspect`.
This runs in `ctx.waitUntil` so it never blocks the response.

---

## 4. Server HEAD measurements as a named fallback tier

**Decision:** The existing `cdn_sizes` table (populated by Worker-side HEAD/GET requests)
is retained but demoted to a clearly-labelled fallback. It is used only when no
browser-measured data exists for a (package, version, export, CDN) combination.

**What it means:**
Three-tier resolution in `/_bundle`:
1. `resource_timings` with ≥40 samples and status `verified` → **established**
2. `resource_timings` with 10–39 samples → **tentative**
3. `cdn_sizes` (HEAD fallback) → **server-estimate**

The badge renders differently depending on tier (e.g., a `~` prefix for server-estimate,
a dashed border for tentative).

---

## 5. Browser automation to seed niche packages

**Decision:** Packages that never reach organic traffic will stay tentative forever.
We will automate measurements using a real browser via a CI/scheduled pipeline
(BrowserStack free-for-OSS tier, or GitHub Actions + Playwright) to seed data for the
long tail.

**Why not a special trusted API path?**
The automation must use the **same UI as a real user** — navigate to `/?pkg=foo`, let the
measurement run naturally via the iframe mechanism, and submit via `/_record` with a real
rendered-DOM client hash. This ensures:
- The seeded data has the same quality as organic data
- No special trust level is needed; it counts toward the same 40-measurement threshold
- The client hash changes when the app changes, so stale seeded data is naturally flagged

**Candidate pipeline:**
- Cloudflare Cron Trigger identifies (pkg, export, cdn) combinations below threshold
- Triggers a BrowserStack Automate session (or GH Actions matrix) pointing at the live site
- Browser visits `/?pkg={pkg}&export={export}`, waits for waterfall to render
- Measurement submits itself naturally
- Session counts as N independent data points (one per browser/OS combination tested)

**What it means:**
- Popular packages: seeded quickly by real users
- Niche packages: seeded by scheduled automation across a matrix of browsers/OS/networks
- The multi-browser runs also give us real data on cross-browser transfer size variance,
  which is itself useful (CDN edge node differences, HTTP/2 vs HTTP/3, etc.)

---

## 6. Deduplication unit

**Decision:** An "independent measurement" is a unique `client_hash`. Multiple POST requests
sharing the same hash count as 1 toward the 40-measurement threshold.

**Why not deduplicate by IP or browser fingerprint?**
IP deduplication breaks for shared networks (offices, universities). Browser fingerprints
are privacy-invasive and unreliable. The rendered DOM hash is privacy-neutral: it's derived
from the measurement output, not the user's identity.

**What it means:**
The `resource_timings` table stores all rows. A companion `client_hashes` table tracks:
```
hash, first_seen, status ('pending' | 'verified' | 'suspect')
```
The count toward threshold = `COUNT(DISTINCT client_hash)` where `status != 'suspect'`.

---

---

## 7. Badge display by data confidence tier

**Decision:** The badge behaves differently depending on what data exists for that package.

| Tier | Badge behaviour |
|---|---|
| No data | Call-to-action: prompt the viewer to click and measure it. No number shown. |
| Tentative (10–39 samples) | Show the size with an `*` asterisk. Badge is a link to the bulk website where the user can see and contribute to the measurement. |
| Established (40+ samples) | Show the size cleanly. No qualifier. |

**Why this specific design?**
- The no-data badge is a self-reinforcing acquisition funnel. Every developer who embeds a
  badge in their README and sees "measure this →" is a potential first contributor. The badge
  markets the tool and seeds its own data.
- The asterisk is honest without being useless. It says "we have a number, but not enough
  people have verified it yet." Linking to the site gives curious users a path to understand
  and contribute.
- Established data earns the right to be shown without qualification. The crowd has spoken.

**What it means for implementation:**
- The badge SVG renderer needs to branch on a `confidence` field from `/_bundle`.
- The no-data state needs a distinct visual — probably a dashed border or muted colour with
  a "measure →" label rather than a number.
- The asterisk badge must be an `<a>` tag wrapping the `<img>`, not just the SVG, since SVG
  links (`<a xlink:href>`) are stripped by most markdown renderers and README hosts.
  Alternatively: encode a `href` in the SVG itself for contexts that render it directly.

---

## Open questions

- **BrowserStack vs GitHub Actions:** BrowserStack gives real device/network diversity;
  GH Actions is zero-cost but homogeneous. Probably start with GH Actions, graduate to
  BrowserStack for variance data.
- **Version churn:** when a new version of a package is released, existing measurements
  are for the old version. The automation pipeline needs to detect new versions and re-seed.
  Version detection is already built (`package_versions` table + `/_bundle-history`).
- **Asterisk badge link target:** link to `/?pkg={pkg}&export={export}` so the user lands
  directly on the measurement UI for that export, ready to contribute.
