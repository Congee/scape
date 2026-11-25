#!/usr/bin/env bash
# DEM cache memory per worker through an Alps session: tiles, MB and heap at peak and at the end. A measurement, not a pass/fail.
# Usage: scripts/smoke/demmem.sh [dev-port] [cdp] [linger-s]
# Needs a dev server on the port and a headless Brave with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5486}
CDP=${2:-9486}
for p in "$PORT" "$CDP"; do
  curl -s -o /dev/null "http://localhost:$p/" || { echo "nothing on port $p" >&2; exit 2; }
done
bun "$(dirname "$0")/demmem.ts" "$CDP" "$PORT" "${3:-0}"
