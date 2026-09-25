#!/usr/bin/env bash
# Motion LOD smoke: a 2600 px canvas hides the listed layers and loads coarse tiles during a pinch and restores all after, refetching no tile; 1400 px is untouched.
# Usage: scripts/smoke/motion-lod.sh [port] [cdp-port] [agent-browser-session] [screenshot-dir] [brave-profile] [gpu-timing-lock-dir]
# Starts what is missing (vite dev, one background Brave) and stops only what it started.
set -uo pipefail

PORT=${1:-5427}
CDP=${2:-9427}
SESSION=${3:-${AGENT_BROWSER_SESSION:-smoke-$CDP}}
OUT=${4:-${TMPDIR:-/tmp}/motion-lod}
PROFILE=${5:-${TMPDIR:-/tmp}/brave-motion-lod}
LOCK=${6:-${TMPDIR:-/tmp}/gpu-timing.lock}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
. "$ROOT/scripts/smoke/brave.sh"
BASE="http://localhost:$PORT"
mkdir -p "$OUT"

VITE=0
if ! curl -s -o /dev/null "$BASE/"; then
  (cd "$ROOT" && bunx vite --port "$PORT" --strictPort >"$OUT/vite-$PORT.log" 2>&1) &
  VITE=1
fi
BRAVE=0
if ! curl -s -o /dev/null "http://localhost:$CDP/json/version"; then
  brave_launch "$CDP" "$PROFILE" || exit 1
  BRAVE=1
fi
for u in "$BASE/" "http://localhost:$CDP/json/version"; do
  for _ in $(seq 300); do curl -s -o /dev/null "$u" && break; sleep 1; done
done

FAILS=0
ROWS=()
check() { # name, ok (0/1), detail
  local status=PASS
  if [ "$2" != 1 ]; then status=FAIL; FAILS=$((FAILS + 1)); fi
  ROWS+=("| $1 | $status | $3 |")
}
# The driver finds the app's tab by origin; a visible one, since a hidden tab's rAF and input acks stall.
agent-browser --cdp "$CDP" --session "$SESSION" open "$BASE/" >/dev/null 2>&1

run() { # viewport
  bun "$ROOT/scripts/smoke/motion-lod.ts" "$CDP" "$PORT" "$1" "$OUT/motion-lod-$1.png" 2>&1 | grep -m1 '^{'
}
q() { bun -e "const r = JSON.parse(await Bun.stdin.text()); console.log($1)" <<<"$2"; }

until mkdir "$LOCK" 2>/dev/null; do sleep 30; done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
WIDE=$(run 2600x1400)
NARROW=$(run 1400x900)
rmdir "$LOCK"
trap - EXIT

if [ -n "$WIDE" ]; then
  check "2600 px: canvas wide enough" "$(q 'r.width >= 2500 ? 1 : 0' "$WIDE")" "$(q '`canvas ${r.width} px, ${r.listed} listed layers shown`' "$WIDE")"
  check "2600 px: listed layers hidden during the pinch" "$(q 'r.listed > 0 && r.maxHidden === r.listed ? 1 : 0' "$WIDE")" "$(q '`${r.maxHidden}/${r.listed} hidden, ${r.frames} frames, zoom ${r.zoom.toFixed(2)}`' "$WIDE")"
  check "2600 px: coarse tiles during the pinch" "$(q 'r.coarse > 0 ? 1 : 0' "$WIDE")" "$(q '`${r.coarse} coarse source-frames`' "$WIDE")"
  check "2600 px: all restored after" "$(q 'r.restored === r.listed && !r.missing.length && JSON.stringify(r.sizes) === JSON.stringify(r.sizesAfter) ? 1 : 0' "$WIDE")" "$(q '`${r.restored}/${r.listed} shown, tile sizes ${JSON.stringify(r.sizesAfter)}${r.missing.length ? ", missing " + r.missing.join(" ") : ""}`' "$WIDE")"
  check "2600 px: restore reuses the fine tiles" "$(q 'r.refetched === 0 ? 1 : 0' "$WIDE")" "$(q '`${r.fetched} tile requests, ${r.refetched} repeats`' "$WIDE")"
else check "2600 px: measured" 0 "no output"; fi
if [ -n "$NARROW" ]; then
  check "1400 px: untouched" "$(q 'r.listed > 0 && r.maxHidden === 0 && r.coarse === 0 && r.restored === r.listed ? 1 : 0' "$NARROW")" "$(q '`canvas ${r.width} px, ${r.maxHidden}/${r.listed} hidden, ${r.coarse} coarse source-frames, ${r.frames} frames`' "$NARROW")"
else check "1400 px: measured" 0 "no output"; fi

[ "$VITE" = 1 ] && lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill
[ "$BRAVE" = 1 ] && brave_stop "$PROFILE"
echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
