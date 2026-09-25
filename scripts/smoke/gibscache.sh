#!/usr/bin/env bash
# GIBS cache smoke: the Offline panel's nightly-tile line, its Clear, and the Night tab refetching after, on desktop and a 390x844 phone; see gibscache.ts.
# Usage: scripts/smoke/gibscache.sh <port> <cdp-port> <shot-dir>
# Needs a dev server on the port, a background Brave with remote debugging on the CDP port, and the internet for GIBS.
set -uo pipefail

PORT=${1:-5469}
CDP=${2:-9469}
SHOTS=${3:-${TMPDIR:-/tmp}/gibscache}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$SHOTS"

curl -s -o /dev/null "http://localhost:$PORT/" || { echo "nothing on port $PORT" >&2; exit 2; }
curl -s -o /dev/null "http://localhost:$CDP/json/version" || { echo "no CDP on port $CDP" >&2; exit 2; }
bun "$ROOT/scripts/smoke/gibscache.ts" "$CDP" "$PORT" "$SHOTS"
RC=$?
echo "screenshots: $SHOTS"
exit $RC
