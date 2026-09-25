#!/usr/bin/env bash
# Model occlusion smoke: other models and buildings in front hide the selected outline and dim its handles on the map. Starts what is missing, stops what it started.
# Usage: scripts/smoke/modelocc.sh [dev-port] [cdp] [shot-dir] [brave-profile]
set -uo pipefail

PORT=${1:-5600}
CDP=${2:-9600}
SHOTS=${3:-${TMPDIR:-/tmp}/modelocc}
PROFILE=${4:-${TMPDIR:-/tmp}/brave-modelocc}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
. "$ROOT/scripts/smoke/brave.sh"
mkdir -p "$SHOTS" "$PROFILE"
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
bun "$ROOT/scripts/smoke/modelocc.ts" "$CDP" "$PORT" "$SHOTS" || RC=1

[ -n "$OWN" ] && lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill
[ "$LAUNCHED" = 1 ] && brave_stop "$PROFILE"
echo "screenshots: $SHOTS"
exit $RC
