#!/usr/bin/env bash
# Sky marks over the photo, horizon and rainbow. Starts what is missing (vite dev, one headless Brave), runs, stops what it started.
# Usage: scripts/smoke/markstop.sh [port] [cdp] [shot-dir] [brave-profile] [label]
set -uo pipefail

PORT=${1:-5470}
CDP=${2:-9470}
SHOTS=${3:-${TMPDIR:-/tmp}/markstop}
PROFILE=${4:-${TMPDIR:-/tmp}/brave-markstop}
LABEL=${5:-$(git -C "$(dirname "$0")" rev-parse --short HEAD)}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
. "$ROOT/scripts/smoke/brave.sh"
mkdir -p "$SHOTS"
VITE=""

if ! curl -s -o /dev/null "http://localhost:$PORT/"; then
  (cd "$ROOT" && exec bunx vite --port "$PORT" --strictPort >"$SHOTS/vite-$PORT.log" 2>&1) &
  VITE=$!
fi
LAUNCHED=0
if ! curl -s -o /dev/null "http://localhost:$CDP/json/version"; then
  brave_launch "$CDP" "$PROFILE" || exit 1
  LAUNCHED=1
fi
for p in "$PORT" "$CDP"; do
  for _ in $(seq 120); do curl -s -o /dev/null "http://localhost:$p/" && break; sleep 1; done
done

bun "$ROOT/scripts/smoke/markstop.ts" "$CDP" "$PORT" "$SHOTS" "$LABEL"
RC=$?

[ -n "$VITE" ] && lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill
[ "$LAUNCHED" = 1 ] && brave_stop "$PROFILE"
echo "screenshots: $SHOTS"
exit $RC
