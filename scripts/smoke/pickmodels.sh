#!/usr/bin/env bash
# Models A/B picks smoke: the phone draw sheet, the ground warning, then P2 (drawing), P3 (import picks) and P4 (photo lock). Starts what is missing, stops what it started.
# Usage: scripts/smoke/pickmodels.sh [dev-port] [cdp] [shot-dir] [brave-profile]
set -uo pipefail

PORT=${1:-5500}
CDP=${2:-9500}
SHOTS=${3:-${TMPDIR:-/tmp}/pickmodels}
PROFILE=${4:-${TMPDIR:-/tmp}/brave-pickmodels}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
. "$ROOT/scripts/smoke/brave.sh"
mkdir -p "$SHOTS/p2" "$SHOTS/p3" "$SHOTS/p4" "$PROFILE"
OWN=

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

RC=0
bun "$ROOT/scripts/smoke/pickmodels.ts" "$CDP" "$PORT" "$SHOTS" || RC=1
bun "$ROOT/scripts/smoke/models-p2.ts" "$CDP" "$PORT" - "$SHOTS/p2" || RC=1
bun "$ROOT/scripts/smoke/models-p3-glb.ts" "$SHOTS/p3" && bun "$ROOT/scripts/smoke/models-p3.ts" "$CDP" "$PORT" "$SHOTS/p3" || RC=1
bun "$ROOT/scripts/smoke/models-p4.ts" "$CDP" "$PORT" - "$SHOTS/p4" || RC=1

[ -n "$OWN" ] && lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill
[ "$LAUNCHED" = 1 ] && brave_stop "$PROFILE"
echo "screenshots: $SHOTS"
exit $RC
