# Contributing to bulk

## Prerequisites

- [Bun](https://bun.sh) (runtime and package manager)
- A Cloudflare account (for deployment)

## Setup

```bash
bun install
```

## Development

Start the local dev server (runs via Wrangler):

```bash
bun run dev
```

This serves the Cloudflare Worker locally with the client assets.

## Project Structure

```
src/
  index.ts              # Worker entry point
  constants.ts          # Shared constants
  providers.ts          # CDN provider definitions
  types.ts              # Shared types
  handlers/
    badge.ts            # Badge generation handler
  utils/
    pkg.ts              # Package resolution
    size.ts             # Size calculation
    svg.ts              # SVG badge rendering
    telemetry.ts        # Request telemetry
  client/               # SolidJS frontend (landing page)
    main.tsx            # Client entry point
    App.tsx             # Root component
    style.css           # Global styles
    index.html          # HTML template
    components/         # UI components (CSS modules)
test/
  index.spec.ts         # Worker tests
public/                 # Built client assets (generated, do not edit)
```

## Building the Client

The SolidJS client is built with Bun's bundler:

```bash
bun run build:client
```

This runs `build-client.ts`, which compiles `src/client/` into `public/`. Wrangler also runs this automatically before deploys via the `build.command` in `wrangler.jsonc`.

## Testing

Tests use Vitest with `@cloudflare/vitest-pool-workers` to run against the Workers runtime:

```bash
bun run test
```

## TypeScript

- Worker code uses the root `tsconfig.json` (target: es2024, strict mode)
- Client code has its own `src/client/tsconfig.json`
- Generate Cloudflare bindings types: `bun run cf-typegen`

## Deployment

```bash
bun run deploy
```

This runs `wrangler deploy`, which builds the client and deploys the worker to Cloudflare.

## Style Guidelines

- Always use `bun` / `bunx` — never `npm`, `npx`, or `node`
- Use tabs for indentation
- CSS modules (`*.module.css`) for component styles
- Keep worker handler logic in `src/handlers/`
- Keep shared utilities in `src/utils/`
