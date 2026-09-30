#!/usr/bin/env bash
# Viewfinder retention smoke: back to the same spot from the map needs no building fetch or rebuild; a far move lets it go.
# Usage: scripts/smoke/vfretain.sh [dev-port] [cdp]
# Needs a dev server on the port and a background Brave with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5462}
CDP=${2:-9462}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)

for p in "$PORT" "$CDP"; do
  curl -s -o /dev/null "http://localhost:$p/" || { echo "nothing on port $p" >&2; exit 2; }
done
bun "$ROOT/scripts/smoke/vfretain.ts" "$CDP" "$PORT"
