#!/usr/bin/env bash
# Prism mesh built in the buildings worker: drag cost, cold load, occlusion answers, viewfinder stills and phone viewport.
# Usage: scripts/smoke/prismworker.sh [dev-port] [cdp] [shot-dir] [brave-profile] [gpu-lock-dir|-] [measure|occ|stills|all] [reference-occ.json|-]
set -uo pipefail

PORT=${1:-5464}
CDP=${2:-9464}
SHOTS=${3:-${TMPDIR:-/tmp}/prismworker}
PROFILE=${4:-${TMPDIR:-/tmp}/brave-prismworker}
LOCK=${5:--}
MODE=${6:-all}
REF=${7:--}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
. "$ROOT/scripts/smoke/brave.sh"
mkdir -p "$SHOTS" "$PROFILE"
OWN=0

if ! curl -s -o /dev/null "http://localhost:$PORT/"; then
  (cd "$ROOT" && bunx vite --port "$PORT" --strictPort >"$SHOTS/vite-$PORT.log" 2>&1) &
  OWN=1
fi
LAUNCHED=0
if ! curl -s -o /dev/null "http://localhost:$CDP/json/version"; then
  brave_launch "$CDP" "$PROFILE" || exit 1
  LAUNCHED=1
fi
for p in "$PORT" "$CDP"; do
  for _ in $(seq 120); do curl -s -o /dev/null "http://localhost:$p/" && break; sleep 1; done
done

bun "$ROOT/scripts/smoke/prismworker.ts" "$CDP" "$PORT" "$SHOTS" "$LOCK" "$MODE" "$REF"
RC=$?

[ "$OWN" = 1 ] && lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill
[ "$LAUNCHED" = 1 ] && brave_stop "$PROFILE"
echo "screenshots: $SHOTS"
exit $RC
