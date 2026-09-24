#!/usr/bin/env bash
# Precise models P3 smoke. Writes its GLBs, starts what is missing (vite dev, one background Brave), runs, stops what it started.
# Usage: scripts/smoke/models-p3.sh [dev-port] [cdp] [shot-dir] [brave-profile]
set -uo pipefail

PORT=${1:-5340}
CDP=${2:-9344}
SHOTS=${3:-${TMPDIR:-/tmp}/models-p3}
PROFILE=${4:-${TMPDIR:-/tmp}/brave-models-p3}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$SHOTS" "$PROFILE"
bun "$ROOT/scripts/smoke/models-p3-glb.ts" "$SHOTS" || exit 1
STARTED=0

if ! curl -s -o /dev/null "http://localhost:$PORT/"; then
  (cd "$ROOT" && bunx vite --port "$PORT" --strictPort >"$SHOTS/vite-$PORT.log" 2>&1) &
  STARTED=1
fi
LAUNCHED=0
if ! curl -s -o /dev/null "http://localhost:$CDP/json/version"; then
  # One background Brave that never takes focus; stopped below by its profile path only.
  open -g -j -n -a "Brave Browser" --args --remote-debugging-port="$CDP" --user-data-dir="$PROFILE" --no-first-run \
    --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling
  LAUNCHED=1
fi
for p in "$PORT" "$CDP"; do
  for _ in $(seq 120); do curl -s -o /dev/null "http://localhost:$p/" && break; sleep 1; done
done

bun "$ROOT/scripts/smoke/models-p3.ts" "$CDP" "$PORT" "$SHOTS"
RC=$?

[ "$STARTED" = 1 ] && lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill
[ "$LAUNCHED" = 1 ] && pgrep -f -- "--user-data-dir=$PROFILE" | xargs -r kill
echo "screenshots: $SHOTS"
exit $RC
