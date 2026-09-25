#!/usr/bin/env bash
# Map click-mode picker and context menu smoke, desktop 1400×900 and phone 390×844.
# Usage: scripts/smoke/mapctl.sh [dev-port] [cdp] [shot-dir]
# Needs a dev server on the port and a background Brave with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5440}
CDP=${2:-9440}
SHOTS=${3:-${TMPDIR:-/tmp}/mapctl}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$SHOTS"

for p in "$PORT" "$CDP"; do
  curl -s -o /dev/null "http://localhost:$p/" || { echo "nothing on port $p" >&2; exit 2; }
done
bun "$ROOT/scripts/smoke/mapctl.ts" "$CDP" "$PORT" "$SHOTS"
RC=$?
echo "screenshots: $SHOTS"
exit $RC
