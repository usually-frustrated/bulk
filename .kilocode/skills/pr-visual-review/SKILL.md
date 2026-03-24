---
name: pr-visual-review
description: After pushing commits on a PR for this project (bulk.frustrated.dev), wait for the Cloudflare Pages bot comment, extract the branch preview URL, render it with Playwright, capture screenshots and component HTML, compare against production (https://bulk.frustrated.dev), identify visual/functional issues, and post a before/after screenshot to the PR description.
---

# PR Visual Review — Cloudflare Pages Branch Preview

Use this skill whenever you need to visually validate a PR's changes against production and attach evidence to the PR.

## Prerequisites

```sh
# Playwright must be available (install if missing)
bunx playwright install chromium --with-deps 2>/dev/null || npx playwright install chromium --with-deps
```

---

## Step 1: Wait for the Cloudflare Deployment

Use the bundled `wait-for-deploy.sh` script, which polls the branch preview URL until it returns a successful HTTP 200 response.

```sh
PR_NUMBER=<PR_NUMBER>
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
SKILL_DIR=".kilocode/skills/pr-visual-review"

BRANCH=$(gh api "repos/${REPO}/pulls/${PR_NUMBER}" --jq '.head.ref')
ALIAS=$(echo "$BRANCH" | tr '/' '-' | tr '[:upper:]' '[:lower:]')

PREVIEW_URL=$(bash "$SKILL_DIR/scripts/wait-for-deploy.sh" "$ALIAS" | tail -1)
echo "Preview URL: $PREVIEW_URL"
PROD_URL="https://bulk.frustrated.dev"
```

The branch alias is the git branch name with `/` replaced by `-` and lowercased. The preview URL pattern is `https://<alias>-bulk.sushruth-sastry.workers.dev`.

---

## Step 2: Capture Screenshots and Component HTML

The Playwright script is bundled at `scripts/capture.mjs` inside this skill. Run it directly:

```sh
SKILL_DIR=".kilocode/skills/pr-visual-review"

PREVIEW_URL="$PREVIEW_URL" \
PROD_URL="$PROD_URL" \
OUT_DIR="/tmp/bulk-review" \
TEST_PKG="zustand" \
  bun "$SKILL_DIR/scripts/capture.mjs"
```

---

## Step 3: Identify Issues

Review the diff output from the script. Common things to check for this project:

| Component | What to look for |
|---|---|
| `exportsTable` | Badge images loading, CDN selector present, copy buttons present |
| `bundleHistory` | SVG chart renders (not blank), version data present, tooltip works |
| `header` | Logo present, title correct |
| `footer` | Links present, not broken |
| Console errors | Any `Failed to fetch` or JS exceptions |
| Layout | No overflow, dark-mode vars applied, no unstyled elements |

---

## Step 4: Upload Screenshots and Update PR Description

### Image Hosting Strategy

Instead of relying on `/tmp` or external hosting, the skill uploads screenshots to a changelog folder within the repo:

```
/docs/changelog/<pr-number>/
├── before.png
├── after.png
├── before.html  (optional: full HTML snapshot)
└── after.html   (optional: full HTML snapshot)
```

This provides:
- **Permanent visual history** in the repo
- **Version-controlled before/after comparison**
- **Easy reference** for future PRs
- **No external dependencies** or upload API limitations

### Upload Screenshots to Changelog

```sh
PR_NUMBER=<PR_NUMBER>
DOCS_DIR="/docs/changelog/${PR_NUMBER}"
mkdir -p "${DOCS_DIR}"

# Copy screenshots to changelog folder
cp /tmp/bulk-review/before.png "${DOCS_DIR}/before.png"
cp /tmp/bulk-review/after.png "${DOCS_DIR}/after.png"

# Commit and push
git add "${DOCS_DIR}/"
git commit -m "chore: add visual review for PR #${PR_NUMBER}"
git push
```

### Update PR Description with Changelog Images

```sh
# Get current PR body
CURRENT_BODY=$(gh pr view "$PR_NUMBER" --json body -q .body)

# Append before/after section with changelog image URLs
NEW_BODY="${CURRENT_BODY}

---
## Visual Review

| Before (production) | After (preview) |
|---|---|
| ![before](https://github.com/usually-frustrated/bulk/blob/main/${DOCS_DIR}/before.png?raw=true) | ![after](https://github.com/usually-frustrated/bulk/blob/main/${DOCS_DIR}/after.png?raw=true) |

Preview: ${PREVIEW_URL}
"

gh pr edit "$PR_NUMBER" --body "$NEW_BODY"
```

### Full End-to-End Script

```sh
#!/usr/bin/env bash
set -e

PR_NUMBER=${1:?Usage: $0 <PR_NUMBER> [TEST_PKG]}
TEST_PKG=${2:-zustand}
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
PROD_URL="https://bulk.frustrated.dev"
OUT_DIR="/tmp/bulk-review-${PR_NUMBER}"
DOCS_DIR="/docs/changelog/${PR_NUMBER}"
mkdir -p "$OUT_DIR"
mkdir -p "$DOCS_DIR"

---

## Full End-to-End Script

```sh
#!/usr/bin/env bash
set -e

PR_NUMBER=${1:?Usage: $0 <PR_NUMBER>}
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
PROD_URL="https://bulk.frustrated.dev"
OUT_DIR="/tmp/bulk-review-${PR_NUMBER}"
mkdir -p "$OUT_DIR"

echo "==> Waiting for Cloudflare bot comment on PR #${PR_NUMBER}..."
for i in $(seq 1 20); do
  CF_COMMENT=$(gh api "repos/${REPO}/issues/${PR_NUMBER}/comments" \
    --jq '[.[] | select(.user.login == "cloudflare-workers-and-pages[bot]") | .body] | last // ""')
  PREVIEW_URL=$(echo "$CF_COMMENT" | grep -i "branch preview" | grep -oE 'https://[^ |]+' | tr -d ' ' | head -1)
  [ -z "$PREVIEW_URL" ] && PREVIEW_URL=$(echo "$CF_COMMENT" | grep -oE 'https://[a-z0-9-]+\.bulk\.pages\.dev' | tail -1)
  [ -n "$PREVIEW_URL" ] && break
  echo "  Attempt $i/20 — no preview URL yet, sleeping 10s..."
  sleep 10
done

[ -z "$PREVIEW_URL" ] && { echo "ERROR: Could not find preview URL"; exit 1; }
echo "==> Preview URL: $PREVIEW_URL"

echo "==> Running Playwright visual capture..."
PREVIEW_URL="$PREVIEW_URL" PROD_URL="$PROD_URL" OUT_DIR="$OUT_DIR" \
  bun ".kilocode/skills/pr-visual-review/scripts/capture.mjs"

echo "==> Creating PR comment with diff summary..."
DIFF_SUMMARY=$(OUT_DIR="$OUT_DIR" bun -e "
  const before = JSON.parse(require('fs').readFileSync(process.env.OUT_DIR + '/before-components.json', 'utf8'));
  const after  = JSON.parse(require('fs').readFileSync(process.env.OUT_DIR + '/after-components.json',  'utf8'));
  const selectors = ['app','header','pkgInput','exportsTable','bundleHistory','footer'];
  const lines = selectors.map(s => {
    const b = before?.html?.[s] !== null;
    const a = after?.html?.[s]  !== null;
    if (b && !a) return \`MISSING in preview: \${s}\`;
    if (!b && a) return \`NEW in preview:     \${s}\`;
    const changed = before?.html?.[s] !== after?.html?.[s];
    return \`\${changed ? 'CHANGED  ' : 'unchanged'}: \${s}\`;
  });
  console.log(lines.join('\\n'));
" 2>/dev/null || echo "(diff unavailable — see attached screenshots)")

gh pr comment "$PR_NUMBER" --body "## Visual Review

**Preview:** ${PREVIEW_URL}
**Production:** ${PROD_URL}

### Component diff
\`\`\`
${DIFF_SUMMARY}
\`\`\`

Screenshots saved locally:
- Before: \`${OUT_DIR}/before.png\`
- After:  \`${OUT_DIR}/after.png\`

> To embed screenshots in the PR description, upload them to a public URL and run:
> \`gh pr edit ${PR_NUMBER} --body \"\$(gh pr view ${PR_NUMBER} --json body -q .body)\\n\\n| Before | After |\\n|---|---|\\n| ![before](<URL>) | ![after](<URL>) |\"\`
"

echo "==> Done. Screenshots at $OUT_DIR/"

# Upload to changelog folder
echo "==> Uploading to changelog..."
cp "$OUT_DIR/before.png" "${DOCS_DIR}/before.png"
cp "$OUT_DIR/after.png" "${DOCS_DIR}/after.png"
cp "$OUT_DIR/before-components.json" "${DOCS_DIR}/before.html"
cp "$OUT_DIR/after-components.json" "${DOCS_DIR}/after.html"

git add "${DOCS_DIR}/"
git commit -m "chore: add visual review for PR #${PR_NUMBER}"
git push

echo "Screenshots committed to docs/changelog/${PR_NUMBER}/"
```

Run with: `bash .kilocode/skills/pr-visual-review/scripts/visual-review.sh <PR_NUMBER>`

---

## Notes

- All scripts use `bun` as the runtime (consistent with the project's stack).
- The Cloudflare bot username is exactly `cloudflare-workers-and-pages[bot]`.
- Branch preview URLs follow the pattern `https://<branch-slug>.bulk.pages.dev` where the slug is the git branch name with `/` replaced by `-` and truncated if long.
- Per-commit preview URLs follow `https://<hash>.bulk.pages.dev`.
- Production is always `https://bulk.frustrated.dev`.
- If the preview URL redirects (e.g., through Cloudflare Access), the Playwright script will stop at the auth page — ensure the Pages project has public access for preview deployments.
