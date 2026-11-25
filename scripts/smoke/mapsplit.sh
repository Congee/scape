#!/usr/bin/env bash
# Map split smoke: layer order at load, with feature layers on and across a basemap switch; no listener or timer growth over map → viewfinder → map.
# Usage: scripts/smoke/mapsplit.sh [dev-port] [cdp] [out-dir] [baseline layer-order.json]
# Needs a dev server on the port and a background Brave with remote debugging on the CDP port; without a baseline it records one.
set -uo pipefail

PORT=${1:-5483}
CDP=${2:-9483}
OUT=${3:-${TMPDIR:-/tmp}/mapsplit}
BASELINE=${4:-}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)

for p in "$PORT" "$CDP"; do
  curl -s -o /dev/null "http://localhost:$p/" || { echo "nothing on port $p" >&2; exit 2; }
done
bun "$ROOT/scripts/smoke/mapsplit.ts" "$CDP" "$PORT" "$OUT" "$BASELINE"
RC=$?
echo "layer order: $OUT/layer-order.json"
exit $RC
