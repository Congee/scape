#!/usr/bin/env bash
# Terrain drag smoke: CPU, mesh rebuilds, frame pacing and holes over an aim drag, plus settled pictures against a baseline.
# Usage: scripts/smoke/terrain-drag.sh [dev-port] [cdp] [shot-dir] [baseline-dir|-] [gpu-lock-dir|-] [quick|drag|stills] [scene[-mm],...]
# Needs a dev server on the port and a background Brave with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5408}
CDP=${2:-9408}
SHOTS=${3:-${TMPDIR:-/tmp}/terrain-drag}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$SHOTS"

for p in "$PORT" "$CDP"; do
  curl -s -o /dev/null "http://localhost:$p/" || { echo "nothing on port $p" >&2; exit 2; }
done
bun "$ROOT/scripts/smoke/terrain-drag.ts" "$CDP" "$PORT" "$SHOTS" "${4:--}" "${5:--}" "${6:-}" "${7:-}"
RC=$?
echo "screenshots: $SHOTS"
exit $RC
