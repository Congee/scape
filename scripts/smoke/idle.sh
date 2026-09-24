#!/usr/bin/env bash
# Quiet smoke: per tab and scene, an idle app draws no GL frames and keeps the renderer and GPU process ≤ 2 %.
# Usage: scripts/smoke/idle.sh [port] [cdp-port] [session] [brave-profile] [idle-seconds] [only-case-substring]
# Starts what is missing (vite dev, one background Brave) and stops only what it started.
set -uo pipefail

PORT=${1:-5427}
CDP=${2:-9427}
SESSION=${3:-${AGENT_BROWSER_SESSION:-smoke-$CDP}}
PROFILE=${4:-${TMPDIR:-/tmp}/brave-$SESSION}
SECS=${5:-30}
ONLY=${6:-}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BASE="http://localhost:$PORT"

VITE=0
if ! curl -s -o /dev/null "$BASE/"; then
  (cd "$ROOT" && bunx vite --port "$PORT" --strictPort >"${TMPDIR:-/tmp}/vite-$PORT.log" 2>&1) &
  VITE=1
fi
BRAVE=0
if ! curl -s -o /dev/null "http://localhost:$CDP/json/version"; then
  mkdir -p "$PROFILE"
  open -g -n -a "Brave Browser" --args --remote-debugging-port="$CDP" --user-data-dir="$PROFILE" --no-first-run \
    --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling
  BRAVE=1
fi
for u in "$BASE/" "http://localhost:$CDP/json/version"; do
  for _ in $(seq 120); do curl -s -o /dev/null "$u" && break; sleep 1; done
done

# The harness reuses the tab on this origin; a background tab is hidden and would pause the clock.
agent-browser --cdp "$CDP" --session "$SESSION" open "$BASE/" >/dev/null 2>&1
bun "$ROOT/scripts/smoke/idle.ts" "$CDP" "$PORT" "$PROFILE" "$SECS" "$ONLY"
RC=$?

[ "$VITE" = 1 ] && lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill
[ "$BRAVE" = 1 ] && pgrep -f -- "--user-data-dir=$PROFILE" | xargs -r kill
exit $RC
