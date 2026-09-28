#!/usr/bin/env bash
# Viewfinder shadow smoke: the shadow map covers the whole filled view at a low evening sun and by day, desktop and phone.
# Usage: scripts/smoke/vfshadow.sh [dev-port] [cdp] [shot-dir] [shots-only]
# Needs a dev server on the port and a background Brave with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5810}
CDP=${2:-9810}
SHOTS=${3:-${TMPDIR:-/tmp}/vfshadow}
ONLY=${4:-}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$SHOTS"

for p in "$PORT" "$CDP"; do
  curl -s -o /dev/null "http://localhost:$p/" || { echo "nothing on port $p" >&2; exit 2; }
done
bun "$ROOT/scripts/smoke/vfshadow.ts" "$CDP" "$PORT" "$SHOTS" "$ONLY"
RC=$?
echo "screenshots: $SHOTS"
exit $RC
