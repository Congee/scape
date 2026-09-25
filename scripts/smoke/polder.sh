#!/usr/bin/env bash
# Polder smoke: the eye and mesh stand on ground below sea level, and settled pictures elsewhere match a baseline.
# Usage: scripts/smoke/polder.sh [dev-port] [cdp] [shot-dir] [baseline-dir|-]
# Needs a dev server on the port and a background Brave with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5433}
CDP=${2:-9433}
SHOTS=${3:-${TMPDIR:-/tmp}/polder}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$SHOTS"

for p in "$PORT" "$CDP"; do
  curl -s -o /dev/null "http://localhost:$p/" || { echo "nothing on port $p" >&2; exit 2; }
done
bun "$ROOT/scripts/smoke/polder.ts" "$CDP" "$PORT" "$SHOTS" "${4:--}"
RC=$?
echo "screenshots: $SHOTS"
exit $RC
