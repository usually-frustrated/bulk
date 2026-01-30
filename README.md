<div align="center">

# ✜ bulk

**Package size badges**

</div>

---

## What Does the Size Mean?

Shows the actual CDN bundle size - the initial load size when using CDN imports. If the CDN points to a bundle, this is the total bundle size. Unlike bundlephobia which shows minified+gzipped npm package sizes.

---

## Usage

```
/:package
```

```
/:provider/:package
```

---

**providers:** jsdelivr, unpkg, skypack, esm.sh

---

## Examples

### React from jsDelivr (default)

```markdown
![jsdelivr size](https://bulk.frustrated.dev/react)
```

![jsdelivr size](https://bulk.frustrated.dev/react)

### React from unpkg

```markdown
![unpkg size](https://bulk.frustrated.dev/unpkg/react)
```

![unpkg size](https://bulk.frustrated.dev/unpkg/react)

### Lodash from skypack

```markdown
![skypack size](https://bulk.frustrated.dev/skypack/lodash)
```

![skypack size](https://bulk.frustrated.dev/skypack/lodash)

### Preact from esm.sh

```markdown
![esm.sh size](https://bulk.frustrated.dev/esmsh/preact)
```

![esm.sh size](https://bulk.frustrated.dev/esmsh/preact)

---

## Force Refresh

Add `?refresh` to bypass cache and fetch fresh data:

```
https://bulk.frustrated.dev/react?refresh
```

---

## Features

- **Multiple CDN providers**: jsDelivr, unpkg, Skypack, esm.sh
- **Smart caching**: Immutable versions cached for 1 year, latest for 1 hour
- **Non-blocking telemetry**: Monitor requests without impacting performance
- **Force refresh**: Bypass cache with `?refresh` parameter
- **Cache versioning**: Automatic cache invalidation on deployments

---

## Deployment

This service runs on Cloudflare Workers.

```bash
# Install dependencies
npm install

# Deploy
npx wrangler deploy

# Watch logs
npx wrangler tail
```

---

## License

MIT
