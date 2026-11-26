#!/usr/bin/env bash
# Viewfinder zoom rebuild cost (build time, wall time, GC); a measurement, not a pass/fail. Pass the timing lock dir to hold it while tracing.
# Usage: scripts/smoke/vfzoom.sh [dev-port] [cdp] [cycles] [lock-dir]
set -uo pipefail

PORT=${1:-5488}
CDP=${2:-9488}
for p in "$PORT" "$CDP"; do
  curl -s -o /dev/null "http://localhost:$p/" || { echo "nothing on port $p" >&2; exit 2; }
done
bun "$(dirname "$0")/vfzoom.ts" "$CDP" "$PORT" "${3:-4}" "${4:-}"
