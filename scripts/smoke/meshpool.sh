#!/usr/bin/env bash
# Viewfinder mesh pool smoke: zoom and drag draw the same picture afterwards, on desktop, a 3840×2160 window and a 390×844 phone,
# the canvas fills the view at full resolution, and every focal × orientation × light settles.
# Usage: scripts/smoke/meshpool.sh [dev-port] [cdp] [shot-dir]
# Needs a dev server on the port and a background Brave with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5730}
CDP=${2:-9730}
SHOTS=${3:-${TMPDIR:-/tmp}/meshpool}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$SHOTS"

for p in "$PORT" "$CDP"; do
  curl -s -o /dev/null "http://localhost:$p/" || { echo "nothing on port $p" >&2; exit 2; }
done
bun "$ROOT/scripts/smoke/meshpool.ts" "$CDP" "$PORT" "$SHOTS"
RC=$?
echo "screenshots: $SHOTS"
exit $RC
