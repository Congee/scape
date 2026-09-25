#!/usr/bin/env bash
# Map zoom feel smoke: trackpad pinch, two-finger scroll and fast swipes at Hoboken, plus secondary scenes, scored on what reached the screen (stutter, dropped frames, latency, lag, easing, long frames).
# Usage: scripts/smoke/map-zoom.sh [port] [cdp-port] [agent-browser-session] [screenshot-dir] [brave-profile] [gpu-timing-lock-dir] [dev|preview]
# Starts what is missing (vite dev or a preview build, one background Brave) and stops only what it started.
set -uo pipefail

PORT=${1:-5426}
CDP=${2:-9426}
SESSION=${3:-${AGENT_BROWSER_SESSION:-smoke-$CDP}}
OUT=${4:-${TMPDIR:-/tmp}/map-zoom}
PROFILE=${5:-${TMPDIR:-/tmp}/brave-map-zoom}
LOCK=${6:-${TMPDIR:-/tmp}/gpu-timing.lock}
MODE=${7:-dev}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
. "$ROOT/scripts/smoke/brave.sh"
BASE="http://localhost:$PORT"
mkdir -p "$OUT"

VITE=0
if ! curl -s -o /dev/null "$BASE/"; then
  if [ "$MODE" = preview ]; then
    (cd "$ROOT" && bunx vite build >"$OUT/build.log" 2>&1 && bunx vite preview --port "$PORT" --strictPort >"$OUT/vite-$PORT.log" 2>&1) &
  else
    (cd "$ROOT" && bunx vite --port "$PORT" --strictPort >"$OUT/vite-$PORT.log" 2>&1) &
  fi
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

ab() { agent-browser --cdp "${CDP:?no CDP port}" --session "$SESSION" "$@"; }
bun "$(dirname "$0")/reset.ts" "$CDP" "$BASE"

FAILS=0
ROWS=()
check() { # name, ok (0/1), detail
  local status=PASS
  if [ "$2" != 1 ]; then status=FAIL; FAILS=$((FAILS + 1)); fi
  ROWS+=("| $1 | $status | $3 |")
}
ok() { awk "BEGIN { exit !($1) }" && echo 1 || echo 0; }

# Budgets sit between clean runs and the injected 30 ms block / forced easing, which must fail them; rAF p95 is shown as it misses both.
STUTTER_PCT=3
DROPPED_PCT=3
LATENCY_P95_MS=40
LAG_MS=60
MIN_GAIN=0.9
EASED_PCT=5
LOAF_MS=80

# The driver finds the app's tab by origin; a visible one, since a hidden tab's rAF and input acks stall.
ab open "$BASE/" >/dev/null 2>&1

measure() { # scene, layers, viewport, extra map-zoom flags...
  local scene=$1 layers=$2 vp=$3
  shift 3
  bun "$ROOT/scripts/smoke/map-zoom.ts" "$CDP" "$PORT" "$scene" "$layers" --viewport "$vp" "$@" 2>&1 | grep -m1 '^{'
}
fields() { bun -e 'const r = JSON.parse(await Bun.stdin.text()); const [z0 = 0, zmax = 0, zmin = 0] = r.zoom; console.log(r.stutterPct, r.pipeline.droppedPct, r.latencyP95, r.lagMs, r.gain, r.easedPct, r.loafMax, +(zmax - zmin).toFixed(1), r.overflow, r.button, r.rafP95, r.build)'; }
budget() { ok "$1 <= $STUTTER_PCT && $2 <= $DROPPED_PCT && $3 <= $LATENCY_P95_MS && $4 <= $LAG_MS && $5 >= $MIN_GAIN && $6 <= $EASED_PCT && $7 <= $LOAF_MS && $8 >= 1"; }
detail() { echo "$9 build: stutter $1%, dropped $2%, latency p95 $3 ms, lag $4 ms, gain $5, eased $6%, worst LoAF $7 ms, zoom span $8, rAF p95 ${10}× period"; }

run() { # name, scene, layers, viewport, flags...
  local name=$1 line st dr lat lag gain eased loaf span wide button raf build
  shift
  line=$(measure "$@" --shot "$OUT/$1-$2-$3.png")
  if [ -z "$line" ]; then check "$name: measured" 0 "no output"; return; fi
  read -r st dr lat lag gain eased loaf span wide button raf build <<<"$(fields <<<"$line")"
  check "$name: within budget, no sideways scroll" "$([ "$(budget "$st" "$dr" "$lat" "$lag" "$gain" "$eased" "$loaf" "$span")" = 1 ] && [ "$wide" = false ] && echo 1 || echo 0)" "$(detail "$st" "$dr" "$lat" "$lag" "$gain" "$eased" "$loaf" "$span" "$build" "$raf")"
  if [ "$3" = 390x844 ]; then check "$name: Record zoom button on screen" "$([ "$button" = true ] && echo 1 || echo 0)" "button $button"; fi
}
inject() { # name, kind: the budget must fail, or it would miss the user's stutter
  local line st dr lat lag gain eased loaf span wide button raf build
  line=$(measure hoboken default 1400x900 --stream pinch --inject "$2")
  if [ -z "$line" ]; then check "$1: measured" 0 "no output"; return; fi
  read -r st dr lat lag gain eased loaf span wide button raf build <<<"$(fields <<<"$line")"
  check "$1: budget catches it" "$([ "$(budget "$st" "$dr" "$lat" "$lag" "$gain" "$eased" "$loaf" "$span")" = 0 ] && echo 1 || echo 0)" "$(detail "$st" "$dr" "$lat" "$lag" "$gain" "$eased" "$loaf" "$span" "$build" "$raf")"
}

until mkdir "$LOCK" 2>/dev/null; do sleep 30; done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
# Hoboken toward the Midtown skyline: where the lag was felt, with the densest 3D buildings.
run "Hoboken pinch" hoboken default 1400x900 --stream pinch
run "Hoboken two-finger scroll" hoboken default 1400x900 --stream scroll --zooms 4
# Fast swipes are what MapLibre took for a mouse wheel and eased.
run "Hoboken fast swipe" hoboken default 1400x900 --stream flick --zooms 3
run "Rotterdam pinch" rotterdam default 1400x900 --stream pinch
run "Manhattan fast swipe" manhattan default 1400x900 --stream flick --zooms 3
# DEM decode and repair are the heaviest per-tile work, and tiles stream in as the pinch crosses zooms.
run "Zermatt 3D terrain pinch" zermatt terrain3d 1400x900 --stream pinch
run "Zermatt hillshade pinch" zermatt hillshade 1400x900 --stream pinch
run "Plain pinch" plain bare 1400x900 --stream pinch
run "Hoboken phone pinch" hoboken default 390x844 --stream pinch
inject "Injected 30 ms block every 300 ms" block
inject "Injected wheel easing" ease
rmdir "$LOCK"
trap - EXIT

[ "$VITE" = 1 ] && lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill
[ "$BRAVE" = 1 ] && brave_stop "$PROFILE"
echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
