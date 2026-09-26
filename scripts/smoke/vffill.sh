#!/usr/bin/env bash
# Viewfinder fill smoke: the picture fills the area, the frame is bordered only where it doesn't, marks show beyond it,
# on desktop, a 3840×2160 window and a 390×844 phone, every focal × orientation × light, with a photo overlay.
# Usage: scripts/smoke/vffill.sh [dev-port] [cdp] [shot-dir] [reference-shot-dir]
# With a reference dir of the same scenes shot on master, the pixels inside the frame must match it.
# Needs a dev server on the port and a background Brave with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5750}
CDP=${2:-9750}
SHOTS=${3:-${TMPDIR:-/tmp}/vffill}
REF=${4:-}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$SHOTS"

for p in "$PORT" "$CDP"; do
  curl -s -o /dev/null "http://localhost:$p/" || { echo "nothing on port $p" >&2; exit 2; }
done
bun "$ROOT/scripts/smoke/vffill.ts" "$CDP" "$PORT" "$SHOTS" "$REF"
RC=$?
echo "screenshots: $SHOTS"
exit $RC
