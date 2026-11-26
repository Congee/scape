#!/usr/bin/env bash
# Worker memory smoke: idle point workers terminate and answer the same when they come back; leaving the viewfinder drops the mesh pool.
# Usage: scripts/smoke/workermem.sh [dev-port] [cdp]
# Needs a dev server on the port and a headless Brave with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5488}
CDP=${2:-9488}
for p in "$PORT" "$CDP"; do
  curl -s -o /dev/null "http://localhost:$p/" || { echo "nothing on port $p" >&2; exit 2; }
done
bun "$(dirname "$0")/workermem.ts" "$CDP" "$PORT"
