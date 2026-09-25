#!/usr/bin/env bash
# Map zoom feel smoke in Firefox: the map-zoom.sh scenes and budgets, driven over WebDriver BiDi, with the worst frame gap standing in for LoAF.
# Usage: scripts/smoke/map-zoom-firefox.sh [port] [bidi-port] [screenshot-dir] [firefox-profile] [gpu-timing-lock-dir] [dev|preview] [WxH@dpr]
# Starts what is missing (vite dev or a preview build, one background Firefox on its own profile) and stops only what it started. Firefox takes focus when it launches, so leave one running on the BiDi port.
set -uo pipefail

PORT=${1:-5426}
BIDI=${2:-9432}
OUT=${3:-${TMPDIR:-/tmp}/map-zoom-firefox}
PROFILE=${4:-${TMPDIR:-/tmp}/firefox-map-zoom}
LOCK=${5:-${TMPDIR:-/tmp}/gpu-timing.lock}
MODE=${6:-dev}
VIEWPORT=${7:-1400x900}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
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
FIREFOX=0
if ! curl -s -o /dev/null "http://127.0.0.1:$BIDI/"; then
  mkdir -p "$PROFILE"
  # Wheel actions through the widget and APZ like a trackpad's; no first-run pages or update prompts.
  cat >"$PROFILE/user.js" <<'EOF'
user_pref("remote.events.async.wheel.enabled", true);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.page", 0);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("app.update.disabledForTesting", true);
user_pref("browser.sessionstore.resume_from_crash", false);
EOF
  open -g -j -n -a Firefox --args -no-remote -profile "$PROFILE" --remote-debugging-port "$BIDI" -width 1600 -height 1100
  FIREFOX=1
fi
for u in "$BASE/" "http://127.0.0.1:$BIDI/"; do
  for _ in $(seq 300); do curl -s -o /dev/null "$u" && break; sleep 1; done
done

FAILS=0
ROWS=()
check() { # name, ok (0/1), detail
  local status=PASS
  if [ "$2" != 1 ]; then status=FAIL; FAILS=$((FAILS + 1)); fi
  ROWS+=("| $1 | $status | $3 |")
}
ok() { awk "BEGIN { exit !($1) }" && echo 1 || echo 0; }

# map-zoom.sh's budgets; Firefox has no LoAF or compositor trace, so the longest gap between input-driven renders takes their place.
STUTTER_PCT=3
LATENCY_P95_MS=40
LAG_MS=60
MIN_GAIN=0.9
EASED_PCT=5
GAP_MS=80

measure() { # scene, layers, viewport, extra flags...
  local scene=$1 layers=$2 vp=$3
  shift 3
  bun "$ROOT/scripts/smoke/map-zoom-firefox.ts" "$BIDI" "$PORT" "$scene" "$layers" --viewport "$vp" "$@" 2>&1 | grep -m1 '^{'
}
fields() { bun -e 'const r = JSON.parse(await Bun.stdin.text()); const [z0 = 0, zmax = 0, zmin = 0] = r.zoom; console.log(r.stutterPct, r.latencyP95, r.lagMs, r.gain, r.easedPct, r.frameDt[2], +(zmax - zmin).toFixed(1), r.overflow, r.button, r.frameDt[1], r.build, r.canvas)'; }
budget() { ok "$1 <= $STUTTER_PCT && $2 <= $LATENCY_P95_MS && $3 <= $LAG_MS && $4 >= $MIN_GAIN && $5 <= $EASED_PCT && $6 <= $GAP_MS && $7 >= 1"; }
detail() { echo "$8 build, canvas $9: stutter $1%, latency p95 $2 ms, lag $3 ms, gain $4, eased $5%, frame gap p95 ${10} / max $6 ms, zoom span $7"; }

run() { # name, scene, layers, viewport, flags...
  local name=$1 line st lat lag gain eased gap span wide button gap95 build canvas
  shift
  line=$(measure "$@" --shot "$OUT/$1-$2-${3%@*}.png")
  if [ -z "$line" ]; then check "$name: measured" 0 "no output"; return; fi
  read -r st lat lag gain eased gap span wide button gap95 build canvas <<<"$(fields <<<"$line")"
  check "$name: within budget, no sideways scroll" "$([ "$(budget "$st" "$lat" "$lag" "$gain" "$eased" "$gap" "$span")" = 1 ] && [ "$wide" = false ] && echo 1 || echo 0)" "$(detail "$st" "$lat" "$lag" "$gain" "$eased" "$gap" "$span" "$build" "$canvas" "$gap95")"
  if [ "${3%@*}" = 390x844 ]; then check "$name: Record zoom button on screen" "$([ "$button" = true ] && echo 1 || echo 0)" "button $button"; fi
}
inject() { # name, kind: the budget must fail, or it would miss the user's stutter
  local line st lat lag gain eased gap span wide button gap95 build canvas
  line=$(measure hoboken default "$VIEWPORT" --stream pinch --inject "$2")
  if [ -z "$line" ]; then check "$1: measured" 0 "no output"; return; fi
  read -r st lat lag gain eased gap span wide button gap95 build canvas <<<"$(fields <<<"$line")"
  check "$1: budget catches it" "$([ "$(budget "$st" "$lat" "$lag" "$gain" "$eased" "$gap" "$span")" = 0 ] && echo 1 || echo 0)" "$(detail "$st" "$lat" "$lag" "$gain" "$eased" "$gap" "$span" "$build" "$canvas" "$gap95")"
}

until mkdir "$LOCK" 2>/dev/null; do sleep 30; done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
run "Hoboken pinch" hoboken default "$VIEWPORT" --stream pinch
run "Hoboken two-finger scroll" hoboken default "$VIEWPORT" --stream scroll --zooms 4
run "Hoboken fast swipe" hoboken default "$VIEWPORT" --stream flick --zooms 3
run "Manhattan fast swipe" manhattan default "$VIEWPORT" --stream flick --zooms 3
run "Zermatt 3D terrain pinch" zermatt terrain3d "$VIEWPORT" --stream pinch
run "Plain pinch" plain bare "$VIEWPORT" --stream pinch
run "Hoboken phone pinch" hoboken default 390x844@3 --stream pinch
inject "Injected 30 ms block every 300 ms" block
inject "Injected wheel easing" ease
rmdir "$LOCK"
trap - EXIT

[ "$VITE" = 1 ] && lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill
[ "$FIREFOX" = 1 ] && pgrep -f "MacOS/firefox -no-remote -profile $PROFILE" | xargs -r kill
echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
