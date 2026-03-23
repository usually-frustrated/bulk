#!/usr/bin/env bash
# Usage: bash wait-for-deploy.sh <EXPECTED_COMMIT>
#
# Polls /_meta/version until the expected commit hash appears.
# Prints the Branch Preview URL on success and exits 0.
# Exits 1 after timeout.
#
# Example:
#   bash wait-for-deploy.sh 2b4c802
set -euo pipefail

EXPECTED=${1:?Usage: $0 <EXPECTED_COMMIT>}
EXPECTED_SHORT="${EXPECTED:0:8}"
PREVIEW_URL="https://feat-pivot-slice-1-bulk.sushruth-sastry.workers.dev"
MAX_ATTEMPTS=${MAX_ATTEMPTS:-24}   # 24 × 15 s = 6 min
SLEEP_SECS=${SLEEP_SECS:-15}

echo "Waiting for commit ${EXPECTED_SHORT} to be deployed..."
echo "Preview URL: ${PREVIEW_URL}"

for i in $(seq 1 "$MAX_ATTEMPTS"); do
  DEPLOYED=$(curl -s "${PREVIEW_URL}/_meta/version" 2>/dev/null | bun -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    console.log(d.commit || '');
  " 2>/dev/null || echo "")

  echo "  attempt $i/${MAX_ATTEMPTS} — deployed: '${DEPLOYED:0:8}' expecting: '${EXPECTED_SHORT}'"

  if [ "${DEPLOYED:0:8}" = "$EXPECTED_SHORT" ]; then
    echo "Deployed!"
    echo "$PREVIEW_URL"
    exit 0
  fi

  sleep "$SLEEP_SECS"
done

echo "ERROR: commit ${EXPECTED_SHORT} not deployed after $((MAX_ATTEMPTS * SLEEP_SECS)) s" >&2
exit 1
