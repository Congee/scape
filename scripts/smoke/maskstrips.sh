#!/usr/bin/env bash
# Map shadow mask through a sinking sun: few re-stamps, each one matching its request, shadows drawn, no errors; desktop and phone.
# Usage: scripts/smoke/maskstrips.sh [dev-port] [cdp] [shot-dir]
# Needs a dev server on the port and a background Brave with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5770}
CDP=${2:-9770}
SHOTS=${3:-${TMPDIR:-/tmp}/maskstrips}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$SHOTS"

for p in "$PORT" "$CDP"; do
  curl -s -o /dev/null "http://localhost:$p/" || { echo "nothing on port $p" >&2; exit 2; }
done
bun "$ROOT/scripts/smoke/maskstrips.ts" "$CDP" "$PORT" "$SHOTS"
RC=$?
echo "screenshots: $SHOTS"
exit $RC
