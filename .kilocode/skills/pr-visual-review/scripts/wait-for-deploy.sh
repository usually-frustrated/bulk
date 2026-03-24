#!/usr/bin/env bash
# Usage: bash wait-for-deploy.sh <BRANCH_ALIAS>
#
# Polls the branch preview URL until it returns a successful response.
# Uses the branch alias to construct the preview URL.
# Prints the Branch Preview URL on success and exits 0.
# Exits 1 after timeout.
#
# Example:
#   bash wait-for-deploy.sh feat-pivot-slice-1
set -euo pipefail

BRANCH_ALIAS=${1:?Usage: $0 <BRANCH_ALIAS>}
# Branch preview URL pattern: https://<alias>-bulk.sushruth-sastry.workers.dev
PREVIEW_URL_BASE="https://${BRANCH_ALIAS}-bulk.sushruth-sastry.workers.dev"
MAX_ATTEMPTS=${MAX_ATTEMPTS:-24}   # 24 × 15 s = 6 min
SLEEP_SECS=${SLEEP_SECS:-15}

echo "Waiting for branch '${BRANCH_ALIAS}' to be deployed..."
echo "Preview URL: ${PREVIEW_URL_BASE}"

for i in $(seq 1 "$MAX_ATTEMPTS"); do
  # Try to access the main page
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${PREVIEW_URL_BASE}/" 2>/dev/null || echo "000")
  
  echo "  attempt $i/${MAX_ATTEMPTS} — HTTP status: ${HTTP_CODE}"

  if [ "$HTTP_CODE" = "200" ]; then
    echo "Deployed successfully!"
    echo "$PREVIEW_URL_BASE"
    exit 0
  fi

  sleep "$SLEEP_SECS"
done

echo "ERROR: branch '${BRANCH_ALIAS}' not deployed after $((MAX_ATTEMPTS * SLEEP_SECS)) s" >&2
exit 1
