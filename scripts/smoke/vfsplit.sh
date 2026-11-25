#!/usr/bin/env bash
# Viewfinder pixel identity: fixed night, day and marker scenes, desktop and phone, against a reference shot dir.
# Usage: scripts/smoke/vfsplit.sh [dev-port] [cdp] [shot-dir] [reference-shot-dir]
# Needs a dev server on the port and a background Brave with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5484}
CDP=${2:-9484}
SHOTS=${3:-${TMPDIR:-/tmp}/vfsplit}
REF=${4:-}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$SHOTS"

for p in "$PORT" "$CDP"; do
  curl -s -o /dev/null "http://localhost:$p/" || { echo "nothing on port $p" >&2; exit 2; }
done
bun "$ROOT/scripts/smoke/vfsplit.ts" "$CDP" "$PORT" "$SHOTS" "$REF"
RC=$?
echo "screenshots: $SHOTS"
exit $RC
