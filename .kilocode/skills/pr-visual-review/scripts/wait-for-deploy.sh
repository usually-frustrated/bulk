#!/usr/bin/env bash
# Usage: bash wait-for-deploy.sh <BRANCH_ALIAS> [AFTER_TIMESTAMP]
#
# Polls `bunx wrangler versions list` until a version with the given branch alias
# appears that was created after AFTER_TIMESTAMP (ISO-8601, defaults to now).
# Prints the Branch Preview URL on success and exits 0.
# Exits 1 after timeout.
#
# Example:
#   bash wait-for-deploy.sh feat-pivot-slice-1
#   bash wait-for-deploy.sh feat-pivot-slice-1 2026-03-22T20:30:00Z
set -euo pipefail

ALIAS=${1:?Usage: $0 <BRANCH_ALIAS> [AFTER_TIMESTAMP]}
AFTER=${2:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}
MAX_ATTEMPTS=${MAX_ATTEMPTS:-24}   # 24 × 15 s = 6 min
SLEEP_SECS=${SLEEP_SECS:-15}

# Derive the preview URL from the alias and the wrangler.jsonc worker name
WORKER_NAME=$(bun -e "
const fs = require('fs');
// strip comments from jsonc
const raw = fs.readFileSync('wrangler.jsonc','utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g,'');
console.log(JSON.parse(raw).name);
" 2>/dev/null)

echo "Worker: ${WORKER_NAME}  alias: ${ALIAS}  waiting for version after ${AFTER}"

for i in $(seq 1 "$MAX_ATTEMPTS"); do
  # Get latest versions as JSON using bunx wrangler
  RAW=$(bunx wrangler versions list --json 2>&1)
  FOUND=$(echo "$RAW" | bun -e "
    const lines = require('fs').readFileSync('/dev/stdin','utf8');
    const json = lines.slice(lines.indexOf('['));
    const vers = JSON.parse(json);
    const alias = process.env.ALIAS;
    const after = new Date(process.env.AFTER);
    const match = vers.filter(v =>
      v.annotations?.['workers/alias'] === alias &&
      new Date(v.metadata.created_on) > after
    ).sort((a,b) => new Date(b.metadata.created_on) - new Date(a.metadata.created_on))[0];
    if (match) {
      console.log(match.id + ' ' + match.metadata.created_on);
    }
  " ALIAS="$ALIAS" AFTER="$AFTER" 2>/dev/null || echo "")

  echo "  attempt $i/${MAX_ATTEMPTS} — $( [ -n "$FOUND" ] && echo "found: $FOUND" || echo "not yet" )"

  if [ -n "$FOUND" ]; then
    VERSION_ID=$(echo "$FOUND" | cut -d' ' -f1)
    # Branch preview URL pattern: https://<alias>-<worker>.<subdomain>.workers.dev
    PREVIEW_URL="https://${ALIAS}-${WORKER_NAME}.sushruth-sastry.workers.dev"
    echo "Deployed! Version: ${VERSION_ID}"
    echo "Preview URL: ${PREVIEW_URL}"
    # Emit just the URL as the final line for easy capture by callers
    echo "$PREVIEW_URL"
    exit 0
  fi

  sleep "$SLEEP_SECS"
done

echo "ERROR: no version with alias '${ALIAS}' found after ${AFTER} within $((MAX_ATTEMPTS * SLEEP_SECS)) s" >&2
exit 1
