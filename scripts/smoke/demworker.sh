#!/usr/bin/env bash
# DEM protocol path without WebCodecs: main-thread ms per Hoboken tile, then terrain on desktop and 390×844, and idle.
# Usage: scripts/smoke/demworker.sh [dev-port] [cdp] [shot-dir] [measure|smoke|both] [gpu-lock-dir|-]
# Needs a dev server on the port and a background Brave with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5710}
CDP=${2:-9710}
SHOTS=${3:-${TMPDIR:-/tmp}/demworker}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$SHOTS"

for p in "$PORT" "$CDP"; do
  curl -s -o /dev/null "http://localhost:$p/" || { echo "nothing on port $p" >&2; exit 2; }
done
bun "$ROOT/scripts/smoke/demworker.ts" "$CDP" "$PORT" "$SHOTS" "${4:-both}" "${5:--}"
RC=$?
echo "screenshots: $SHOTS"
exit $RC
