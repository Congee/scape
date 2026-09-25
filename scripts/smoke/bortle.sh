#!/usr/bin/env bash
# Bortle smoke: VIIRS sky brightness and Bortle at camera and target, on desktop and a 390x844 phone; see bortle.ts.
# Usage: scripts/smoke/bortle.sh <port> <cdp-port> <shot-dir> [gpu-timing-lock-dir|-]
# Needs a dev server on the port and a background Brave with remote debugging on the CDP port. Tiles are synthetic, written to the shot dir at runtime.
set -uo pipefail

PORT=${1:-5444}
CDP=${2:-9444}
SHOTS=${3:-${TMPDIR:-/tmp}/bortle}
LOCK=${4:--}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TILES="$SHOTS/tiles"
mkdir -p "$SHOTS"

curl -s -o /dev/null "http://localhost:$PORT/" || { echo "nothing on port $PORT" >&2; exit 2; }
curl -s -o /dev/null "http://localhost:$CDP/json/version" || { echo "no CDP on port $CDP" >&2; exit 2; }
uv run -q --with h5py --with numpy "$ROOT/scripts/smoke/bortle-tiles.py" "$TILES" >/dev/null || { echo "could not write the synthetic tiles" >&2; exit 1; }
bun "$ROOT/scripts/smoke/bortle.ts" "$CDP" "$PORT" "$SHOTS" "$TILES" "$LOCK"
RC=$?
rm -rf "$TILES"
echo "screenshots: $SHOTS"
exit $RC
