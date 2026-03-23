#!/usr/bin/env bash
# Usage: bash visual-review.sh <PR_NUMBER> [TEST_PKG]
# Waits for the latest Cloudflare Workers deployment for the PR branch,
# runs Playwright comparison against production, posts result to PR.
set -euo pipefail

PR_NUMBER=${1:?Usage: $0 <PR_NUMBER> [TEST_PKG]}
TEST_PKG=${2:-zustand}
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
PROD_URL="https://bulk.frustrated.dev"
OUT_DIR="/tmp/bulk-review-${PR_NUMBER}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$OUT_DIR"

# ── 1. Derive branch alias and wait for deployment ────────────────────────────
BRANCH=$(gh api "repos/${REPO}/pulls/${PR_NUMBER}" --jq '.head.ref')
# Cloudflare alias: branch name with '/' → '-', lowercased
ALIAS=$(echo "$BRANCH" | tr '/' '-' | tr '[:upper:]' '[:lower:]')
AFTER=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "==> Waiting for deployment of branch '${BRANCH}' (alias: ${ALIAS})..."
# wait-for-deploy.sh prints the preview URL as its last line
PREVIEW_URL=$(bash "$SCRIPT_DIR/wait-for-deploy.sh" "$ALIAS" "$AFTER" | tail -1)

if [ -z "$PREVIEW_URL" ]; then
  echo "ERROR: could not determine preview URL." >&2
  exit 1
fi
echo "Preview URL: $PREVIEW_URL"

# ── 2. Install Playwright if needed ──────────────────────────────────────────
if ! bun -e "import('playwright')" 2>/dev/null; then
  echo "==> Installing Playwright..."
  bun add -d playwright
  bunx playwright install chromium --with-deps
fi

# ── 3. Run Playwright (using bundled script) ──────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "==> Running Playwright visual capture (pkg=${TEST_PKG})..."
PREVIEW_URL="$PREVIEW_URL" \
PROD_URL="$PROD_URL" \
OUT_DIR="$OUT_DIR" \
TEST_PKG="$TEST_PKG" \
  bun "$SCRIPT_DIR/capture.mjs"

# ── 5. Read diff report ───────────────────────────────────────────────────────
DIFF_OUTPUT=$(OUT_DIR="$OUT_DIR" bun -e "
const r = JSON.parse(require('fs').readFileSync(process.env.OUT_DIR + '/diff-report.json', 'utf8'));
if (r.issues.length === 0) {
  console.log('No issues detected. All components present and changed as expected.');
} else {
  console.log('Issues found:\n' + r.issues.map(i => '  • ' + i).join('\n'));
}
")

# ── 6. Post PR comment ────────────────────────────────────────────────────────
echo "==> Posting visual review comment to PR #${PR_NUMBER}..."

gh pr comment "$PR_NUMBER" --body "## Visual Review

| | URL |
|---|---|
| **Before (production)** | ${PROD_URL} |
| **After (preview)** | ${PREVIEW_URL} |

### Component analysis (pkg: \`${TEST_PKG}\`)
\`\`\`
${DIFF_OUTPUT}
\`\`\`

### Screenshots

Screenshots were saved locally at \`${OUT_DIR}/\`.
To embed them in this PR description, upload to a public host (e.g. GitHub issue/gist) and run:

\`\`\`sh
BEFORE_URL=<url-to-before.png>
AFTER_URL=<url-to-after.png>
BODY=\"\$(gh pr view ${PR_NUMBER} --json body -q .body)\"
gh pr edit ${PR_NUMBER} --body \"\${BODY}

---
## Visual Review

| Before (production) | After (preview) |
|---|---|
| ![](\${BEFORE_URL}) | ![](\${AFTER_URL}) |
\"
\`\`\`
"

echo "==> Done."
echo "  Before screenshot : ${OUT_DIR}/before.png"
echo "  After screenshot  : ${OUT_DIR}/after.png"
echo "  Diff report       : ${OUT_DIR}/diff-report.json"
