#!/usr/bin/env bash
# GPU-occluded sky marks: stars and day paths drawn by the picture pass hide exactly where the CPU occluder says, dashed paths stay dashed.
# Usage: scripts/smoke/gpuocc.sh [port] [cdp-port] [screenshot-dir] [brave-profile] [reference-dir] [check|shots]
# A reference dir of shots from before (same names) adds a "looks the same" check per cell; "shots" only takes those, on any build.
# Starts what is missing (vite dev, one headless Brave) and stops only what it started.
set -uo pipefail

PORT=${1:-5436}
CDP=${2:-9436}
OUT=${3:-${TMPDIR:-/tmp}/gpuocc}
PROFILE=${4:-${TMPDIR:-/tmp}/brave-gpuocc}
REF=${5:-}
MODE=${6:-check}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BASE="http://localhost:$PORT"
PY="$ROOT/scripts/smoke/gpuocc.py"
mkdir -p "$OUT"

VITE=0
if ! curl -s -o /dev/null "$BASE/"; then
  (cd "$ROOT" && bunx vite --port "$PORT" --strictPort >"$OUT/vite-$PORT.log" 2>&1) &
  VITE=1
fi
BRAVE=0
if ! curl -s -o /dev/null "http://localhost:$CDP/json/version"; then
  mkdir -p "$PROFILE"
  # Headless only: any windowed launch, even open -g -j, can steal focus.
  nohup "${BRAVE_BIN:-/nix/store/4fripln844kh7xfjfh803hr2nm235v4x-brave-1.94.121/Applications/Brave Browser.app/Contents/MacOS/Brave Browser}" --headless=new \
    --remote-debugging-port="$CDP" --user-data-dir="$PROFILE" --no-first-run \
    --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling about:blank >/dev/null 2>&1 &
  BRAVE=1
fi
for u in "$BASE/" "http://localhost:$CDP/json/version"; do
  for _ in $(seq 120); do curl -s -o /dev/null "$u" && break; sleep 1; done
done

SESSION=${AGENT_BROWSER_SESSION:-smoke-$CDP}
ab() { agent-browser --cdp "${CDP:?no CDP port}" --session "$SESSION" "$@"; }
js() { ab eval "$1" | sed -e 's/^"//' -e 's/"$//' -e 's/\\"/"/g'; }

FAILS=0
ROWS=()
check() { # name, ok (0/1), detail
  local status=PASS
  if [ "$2" != 1 ]; then status=FAIL; FAILS=$((FAILS + 1)); fi
  ROWS+=("| $1 | $status | $3 |")
}
ok() { awk "BEGIN { exit !($1) }" && echo 1 || echo 0; }

# Exchange Place facing One WTC: towers against open sky.
CAM="40.7163,-74.0325"
TGT="40.7130,-74.0132"
DAY="2026-06-21T11:30Z"
NIGHT="2026-06-22T04:00Z"
READY='(() => { const p = window.__scape?.prism; return !!p && p.buildings > 0 && !window.__scape.buildings.getState().busy && !(p.lod2 && p.lod2.busy) && (!!window.__scape.marks || MODE_SHOTS); })()'
READY=${READY/MODE_SHOTS/$([ "$MODE" = shots ] && echo true || echo false)}

wait_for() { # js condition, tries of 0.5 s
  local i
  for ((i = 0; i < ${2:-60}; i++)); do
    [ "$(js "!!($1)")" = true ] && return 0
    ab screenshot "$OUT/.frame.png" >/dev/null 2>&1
    sleep 0.5
  done
  return 1
}

go() { # url
  local i
  for i in 1 2 3; do
    ab open "$1" >/dev/null 2>&1 && wait_for 'window.__scape' 40 && break
    sleep 1
  done
  # Names off: a label beside a star would count as that star's pixels.
  js '(() => { window.__scape.settings.getState().update({ terrain: true }); window.__scape.composition.getState().update({ showBuildings: true, showStars: true, showPaths: true, showStarNames: false, showConstellations: false, showTrails: false }); window.__scape.markProbe = true; return "ok"; })()' >/dev/null
  wait_for "$READY" 180 || { ab reload >/dev/null 2>&1; wait_for "$READY" 180; }
  sleep 2
}

bmp() { # png → bmp beside it
  sips -s format bmp "$1" --out "${1%.png}.bmp" >/dev/null 2>&1
  echo "${1%.png}.bmp"
}

# Shot with the given toggle on and off, and the probe of the "on" frame.
pair() { # name, toggle
  local on="$OUT/$1.png" off="$OUT/$1-off.png"
  js "(() => { window.__scape.composition.getState().update({ $2: true }); return 'ok'; })()" >/dev/null
  ab screenshot "$on" >/dev/null
  ab screenshot "$on" >/dev/null
  js 'JSON.stringify(window.__scape.marks.probe ?? [])' >"$OUT/$1.json"
  js "(() => { window.__scape.composition.getState().update({ $2: false }); return 'ok'; })()" >/dev/null
  ab screenshot "$off" >/dev/null
  ab screenshot "$off" >/dev/null
  js "(() => { window.__scape.composition.getState().update({ $2: true }); return 'ok'; })()" >/dev/null
  echo "$(bmp "$on") $(bmp "$off") $OUT/$1.json"
}

vf_url() { # instant, focal, orientation
  echo "$BASE/viewfinder?camera=$CAM&target=$TGT&t=$1&f=$2$([ "$3" = P ] && echo '&o=p')"
}

cell() { # focal, orientation, day|night, label prefix
  local f=$1 o=$2 t=$3 name="$4$3-$1-$2" instant dpr marks geo errs a b p stats
  instant=$([ "$t" = day ] && echo "$DAY" || echo "$NIGHT")
  ab errors --clear >/dev/null 2>&1
  go "$(vf_url "$instant" "$f" "$o")"
  if [ "$f" -ge 200 ]; then
    # Long lenses see no skyline here: aim along the sun's path, then move the sun out of frame.
    js "(() => { const s = window.__scape, c = s.prism.cam; s.composition.getState().aim(c.sunAz, c.sunAlt); s.world.getState().setTime(s.world.getState().time + $((f >= 2400 ? 10 : f >= 600 ? 30 : 90)) * 60000); return 'ok'; })()" >/dev/null
    wait_for "$READY" 180
    sleep 2
  fi
  if [ "$MODE" = shots ]; then
    ab screenshot "$OUT/$name.png" >/dev/null
    ab screenshot "$OUT/$name.png" >/dev/null
    return
  fi
  dpr=$(js 'devicePixelRatio')
  marks=$(js 'window.__scape.marks.count')
  geo=$(js '(() => { const r = document.querySelector("canvas.vf").getBoundingClientRect(), f = window.__scape.prism.cam.frame; return [r.left, r.top, f.x, f.y, f.w, f.h].join(" "); })()' | tr -d '"')
  if [ "$t" = night ] && [ "$f" -lt 200 ]; then
    read -r a b p <<<"$(pair "$name" showStars)"
    stats=$(python3 "$PY" stars "$a" "$b" "$p" "$dpr" "$geo")
    eval "$stats"
    # shellcheck disable=SC2154
    check "$name: stars in open sky drawn, behind towers not" "$(ok "$marks > 0 && $open > 0 && $behind > 0 && $shown >= 0.8 * $open && $leaked <= 0.1 * $behind + 1")" "$marks marks; $shown/$open open-sky stars lit, $leaked/$behind behind buildings lit"
  else
    read -r a b p <<<"$(pair "$name" showPaths)"
    stats=$(python3 "$PY" paths "$a" "$b" "$p" "$dpr" "$geo")
    eval "$stats"
    # shellcheck disable=SC2154
    check "$name: paths solid in sky, dashed behind" "$(ok "$marks > 0 && $solidN + $ghostN > 0 && ($solidN == 0 || $solid >= 0.8) && ($ghostN == 0 || ($ghost >= 0.15 && $ghost <= 0.75))")" "$marks marks; solid $solid of $solidN samples lit, ghost $ghost of $ghostN"
  fi
  errs=$(ab errors 2>/dev/null | grep -ci -E "error|overlayGl" || true)
  check "$name: no page errors" "$([ "$errs" = 0 ] && echo 1 || echo 0)" "$errs error lines"
  if [ -n "$REF" ] && [ -f "$REF/$name.png" ]; then
    stats=$(python3 "$PY" same "$(bmp "$OUT/$name.png")" "$(bmp "$REF/$name.png")")
    eval "$stats"
    # shellcheck disable=SC2154
    check "$name: looks as before" "$(ok "$differ < 0.5")" "$differ % of pixels differ by > 32"
  fi
}

ab set viewport 1400 900 1.5 >/dev/null
for f in 24 200 600 2400; do
  for o in L P; do
    for t in day night; do cell "$f" "$o" "$t" ""; done
  done
done

# Phone.
ab set viewport 390 844 3 >/dev/null
cell 24 P night phone-
cell 200 P day phone-
wide=$(js 'document.documentElement.scrollWidth > window.innerWidth')
check "phone 390×844: no sideways scroll" "$([ "$wide" = false ] && echo 1 || echo 0)" "overflow $wide"
ab set viewport 1400 900 >/dev/null

js '(() => { delete window.__scape.markProbe; window.__scape.composition.getState().update({ showStarNames: true }); return "ok"; })()' >/dev/null
rm -f "$OUT/.frame.png" "$OUT"/*.bmp
[ -n "$REF" ] && rm -f "$REF"/*.bmp
[ "$VITE" = 1 ] && lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill
[ "$BRAVE" = 1 ] && pgrep -f -- "--user-data-dir=$PROFILE" | xargs -r kill
echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
