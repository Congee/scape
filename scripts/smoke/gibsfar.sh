#!/usr/bin/env bash
# GIBS far-night smoke: a cold point reads z8 on every night and z6 on the far nights only, desktop and 390x844; see gibsfar.ts.
# Usage: scripts/smoke/gibsfar.sh <port> <cdp-port> <shot-dir>
# Needs a dev server on the port, a background Brave with remote debugging on the CDP port, and the internet for GIBS.
set -uo pipefail

PORT=${1:-5473}
CDP=${2:-9473}
SHOTS=${3:-${TMPDIR:-/tmp}/gibsfar}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$SHOTS"

curl -s -o /dev/null "http://localhost:$PORT/" || { echo "nothing on port $PORT" >&2; exit 2; }
curl -s -o /dev/null "http://localhost:$CDP/json/version" || { echo "no CDP on port $CDP" >&2; exit 2; }
bun "$ROOT/scripts/smoke/gibsfar.ts" "$CDP" "$PORT" "$SHOTS"
RC=$?
echo "screenshots: $SHOTS"
exit $RC
