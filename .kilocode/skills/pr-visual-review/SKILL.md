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

Use the bundled `wait-for-deploy.sh` script, which polls `bunx wrangler versions list` until a version with the correct branch alias appears. This is more reliable than parsing bot comments.

```sh
PR_NUMBER=<PR_NUMBER>
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
SKILL_DIR=".kilocode/skills/pr-visual-review"

BRANCH=$(gh api "repos/${REPO}/pulls/${PR_NUMBER}" --jq '.head.ref')
ALIAS=$(echo "$BRANCH" | tr '/' '-' | tr '[:upper:]' '[:lower:]')
AFTER=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

PREVIEW_URL=$(bash "$SKILL_DIR/scripts/wait-for-deploy.sh" "$ALIAS" "$AFTER" | tail -1)
echo "Preview URL: $PREVIEW_URL"
PROD_URL="https://bulk.frustrated.dev"
```

The branch alias is the git branch name with `/` replaced by `-` and lowercased. The preview URL pattern is `https://<alias>-<worker-name>.sushruth-sastry.workers.dev`.

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

GitHub does not support direct image uploads via the CLI, so encode screenshots as base64 and upload to a gist, or use the GitHub upload API via a comment first, then reference in the description.

**Recommended approach — attach via PR comment + update description:**

```sh
# 1. Upload images by creating a PR comment with them embedded
BEFORE_B64=$(base64 -i /tmp/bulk-review/before.png)
AFTER_B64=$(base64 -i /tmp/bulk-review/after.png)

# GitHub Markdown can embed images hosted via URLs.
# Easiest: upload to the PR itself as review comments with attachments (not supported by gh CLI).
# Best reliable approach: create a gist with the images, then reference URLs.

# Create a gist containing the screenshots
gh gist create /tmp/bulk-review/before.png /tmp/bulk-review/after.png \
  --desc "Visual diff for PR #${PR_NUMBER}" \
  --public

# Grab the raw URLs from the gist
GIST_URL=$(gh gist list --limit 1 --json url -q '.[0].url')
echo "Gist: $GIST_URL"
```

Alternatively (simpler), attach images via a PR comment and include a diff summary:

```sh
# Run capture and pipe output for the diff summary
DIFF_SUMMARY=$(PREVIEW_URL="$PREVIEW_URL" PROD_URL="$PROD_URL" OUT_DIR="/tmp/bulk-review" \
  bun ".kilocode/skills/pr-visual-review/scripts/capture.mjs" 2>&1 | grep -A100 'COMPONENT DIFF')

# Create a comment with the diff summary
# (Images must be pasted or hosted externally; attach via GitHub web UI if needed)
gh pr comment "$PR_NUMBER" --body "## Visual Review

### Component diff
\`\`\`
${DIFF_SUMMARY}
\`\`\`

### Before (production — https://bulk.frustrated.dev)
_Screenshot: \`/tmp/bulk-review/before.png\` — attach manually or via gist_

### After (branch preview — ${PREVIEW_URL})
_Screenshot: \`/tmp/bulk-review/after.png\` — attach manually or via gist_
"
```

**To embed screenshots directly in the PR description** (requires the images to be accessible via URL):

```sh
# Get current PR body
CURRENT_BODY=$(gh pr view "$PR_NUMBER" --json body -q .body)

# Append before/after section (replace <BEFORE_URL> and <AFTER_URL> with actual hosted URLs)
NEW_BODY="${CURRENT_BODY}

---
## Visual Review

| Before (production) | After (preview) |
|---|---|
| ![before](<BEFORE_URL>) | ![after](<AFTER_URL>) |

Preview: ${PREVIEW_URL}"

gh pr edit "$PR_NUMBER" --body "$NEW_BODY"
```

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
