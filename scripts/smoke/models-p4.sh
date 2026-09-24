#!/usr/bin/env bash
# Precise models P4 smoke (occlusion by models, reference photo). Starts what is missing (vite dev, a built preview, one background Brave), runs, stops what it started.
# Usage: scripts/smoke/models-p4.sh [dev-port] [preview-port] [cdp] [shot-dir] [brave-profile]
set -uo pipefail

PORT=${1:-5350}
PREVIEW=${2:--}
CDP=${3:-9354}
SHOTS=${4:-${TMPDIR:-/tmp}/models-p4}
PROFILE=${5:-${TMPDIR:-/tmp}/brave-models-p4}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$SHOTS" "$PROFILE"
OWN=()

up() { curl -s -o /dev/null "http://localhost:$1/"; }

if ! up "$PORT"; then
  (cd "$ROOT" && bunx vite --port "$PORT" --strictPort >"$SHOTS/vite-$PORT.log" 2>&1) &
  OWN+=("$PORT")
fi
if [ "$PREVIEW" != - ] && ! up "$PREVIEW"; then
  (cd "$ROOT" && bunx vite build >"$SHOTS/build.log" 2>&1 && bunx vite preview --port "$PREVIEW" --strictPort >"$SHOTS/preview-$PREVIEW.log" 2>&1) &
  OWN+=("$PREVIEW")
fi
LAUNCHED=0
if ! curl -s -o /dev/null "http://localhost:$CDP/json/version"; then
  # One background Brave that never takes focus; stopped below by its profile path only.
  open -g -n -a "Brave Browser" --args --remote-debugging-port="$CDP" --user-data-dir="$PROFILE" --no-first-run
  LAUNCHED=1
fi
for p in "$PORT" "$([ "$PREVIEW" != - ] && echo "$PREVIEW")" "$CDP"; do
  [ -z "$p" ] && continue
  for _ in $(seq 120); do curl -s -o /dev/null "http://localhost:$p/" && break; sleep 1; done
done

bun "$ROOT/scripts/smoke/models-p4.ts" "$CDP" "$PORT" "$PREVIEW" "$SHOTS"
RC=$?

# Only the servers this run started.
for p in ${OWN[@]+"${OWN[@]}"}; do lsof -ti "tcp:$p" -sTCP:LISTEN 2>/dev/null | xargs -r kill; done
[ "$LAUNCHED" = 1 ] && pgrep -f -- "--user-data-dir=$PROFILE" | xargs -r kill
echo "screenshots: $SHOTS"
exit $RC
