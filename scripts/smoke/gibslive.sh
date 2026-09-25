#!/usr/bin/env bash
# GIBS live smoke: VIIRS nightly sky readouts from runtime GIBS tiles, on desktop and a 390x844 phone; see gibslive.ts.
# Usage: scripts/smoke/gibslive.sh <port> <cdp-port> <shot-dir>
# Needs a dev server on the port, a background Brave with remote debugging on the CDP port, and the internet for GIBS.
set -uo pipefail

PORT=${1:-5467}
CDP=${2:-9467}
SHOTS=${3:-${TMPDIR:-/tmp}/gibslive}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$SHOTS"

curl -s -o /dev/null "http://localhost:$PORT/" || { echo "nothing on port $PORT" >&2; exit 2; }
curl -s -o /dev/null "http://localhost:$CDP/json/version" || { echo "no CDP on port $CDP" >&2; exit 2; }
bun "$ROOT/scripts/smoke/gibslive.ts" "$CDP" "$PORT" "$SHOTS"
RC=$?
echo "screenshots: $SHOTS"
exit $RC
