#!/usr/bin/env bash
# Aim smoke: one Aim control (Target / Sun / Moon / GC / Free) on the map's Frame tab and the viewfinder's View tab;
# a GC lock follows the time, a drag frees it, and both pages show the same lock.
# Usage: scripts/smoke/aim.sh [port] [cdp-port] [screenshot-dir] [shot-tag] [shots]
# Needs a dev server on the port; launches a headless Brave on the CDP port unless one answers, and stops only what it started.
# With a shot tag, saves <tag>-{map,viewfinder}-{desktop,390}.png of the Aim section; "shots" skips the checks.
set -uo pipefail

PORT=${1:-5473}
CDP=${2:-9473}
OUT=${3:-${TMPDIR:-/tmp}/aim}
TAG=${4:-}
ONLY=${5:-}
BASE="http://localhost:$PORT"
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
. "$ROOT/scripts/smoke/brave.sh"
mkdir -p "$OUT"
PROFILE="$OUT/brave-profile"

BRAVE=0
if ! curl -s -o /dev/null "http://localhost:$CDP/json/version"; then
  brave_launch "$CDP" "$PROFILE" || exit 1
  BRAVE=1
  for _ in $(seq 60); do curl -s -o /dev/null "http://localhost:$CDP/json/version" && break; sleep 0.5; done
fi

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
wait_for() { # js condition, tries of 0.25 s
  local i
  for ((i = 0; i < ${2:-40}; i++)); do
    [ "$(js "!!($1)")" = true ] && return 0
    sleep 0.25
  done
  return 1
}

CAM='{ lat: 46.5476, lng: 7.9806 }'
TGT='{ lat: 46.5775, lng: 8.0053 }'
NIGHT=$(($(date -u -j -f '%Y-%m-%dT%H:%M:%S' '2026-07-15T22:00:00' +%s 2>/dev/null || date -u -d '2026-07-15T22:00:00' +%s) * 1000))
C='window.__scape.composition.getState()'
# The Aim section of the open tab, found by its heading.
AIM_SEC='[...document.querySelectorAll(".tab-body .psec")].find((s) => s.querySelector(".psec-h")?.textContent === "Aim")'
LOCK="(() => { const s = $AIM_SEC; return s?.querySelector('[role=radiogroup][aria-label=Aim] [aria-checked=true]')?.dataset.aimLock ?? 'none'; })()"

setup() { # path, tab
  ab open "$BASE/$1" >/dev/null
  wait_for 'window.__scape?.world' 80
  js "(() => { const w = window.__scape.world.getState(); w.setPin($CAM); w.setPin2?.($TGT); w.setTime($NIGHT); return 'ok'; })()" >/dev/null
  wait_for '!!document.querySelector(".panel-inner .tablist")' 80
  js '(() => { document.querySelector(".panel-expand")?.click(); return "ok"; })()' >/dev/null
  tab "$2"
}
tab() { # panel tab
  js "(() => { document.getElementById('ptab-$1').click(); return 'ok'; })()" >/dev/null
  wait_for "document.getElementById('ptab-$1')?.getAttribute('aria-selected') === 'true' && !!($AIM_SEC)" 40
  sleep 0.3
}
shot() { # name
  [ -n "$TAG" ] || return 0
  wait_for "!($AIM_SEC)?.textContent.includes('…')" 40
  js "(() => { $AIM_SEC?.scrollIntoView({ block: 'start' }); return 'ok'; })()" >/dev/null
  sleep 0.2
  js "(() => { const s = $AIM_SEC; if (s) s.id = 'aim-shot'; return 'ok'; })()" >/dev/null
  ab screenshot '#aim-shot' "$OUT/$TAG-$1.png" >/dev/null
}

for vp in "desktop 1600 1000" "390 390 844"; do
  read -r name w h <<<"$vp"
  ab set viewport "$w" "$h" >/dev/null
  setup "" Frame
  shot "map-$name"
  setup viewfinder View
  shot "viewfinder-$name"
done

if [ "$ONLY" != shots ]; then
  ab set viewport 1600 1000 >/dev/null
  setup viewfinder View
  wait_for '!!document.querySelector("canvas.vf")' 80
  opts=$(js "(() => [...($AIM_SEC).querySelectorAll('[role=radio]')].map((b) => b.textContent).join(','))()")
  check "one Aim radiogroup with five locks" "$([ "$opts" = 'Target,Sun,Moon,GC,Free' ] && echo 1 || echo 0)" "$opts"
  old=$(js '[...document.querySelectorAll(".tab-body button")].filter((b) => /Aim at/.test(b.textContent)).length')
  check "old aim buttons gone" "$([ "$old" = 0 ] && echo 1 || echo 0)" "$old"

  js "(() => { $AIM_SEC.querySelector('[data-aim-lock=Gc]').click(); return 'ok'; })()" >/dev/null
  wait_for "$C.aimLock === 'Gc'" 20
  a0=$(js "$C.azimuthDeg.toFixed(2)")
  js "(() => { window.__scape.world.getState().setTime($NIGHT + 2 * 3600e3); return 'ok'; })()" >/dev/null
  sleep 0.3
  a1=$(js "$C.azimuthDeg.toFixed(2)")
  check "GC lock follows the time" "$(awk -v a="$a0" -v b="$a1" 'BEGIN { d = a - b; print (d > 5 || d < -5) ? 1 : 0 }')" "az $a0 -> $a1 over 2 h"
  ro=$(js "($AIM_SEC).querySelectorAll('input').length")
  check "locked angles are readouts" "$([ "$ro" = 0 ] && echo 1 || echo 0)" "$ro inputs"

  ab open "$BASE/" >/dev/null
  wait_for '!!document.querySelector(".panel-inner .tablist")' 80
  js '(() => { document.querySelector(".panel-expand")?.click(); return "ok"; })()' >/dev/null
  tab Frame
  l=$(js "$LOCK")
  check "map shows the viewfinder's lock" "$([ "$l" = Gc ] && echo 1 || echo 0)" "$l"

  ab open "$BASE/viewfinder" >/dev/null
  wait_for '!!document.querySelector("canvas.vf")' 80
  js '(() => { document.querySelector(".panel-expand")?.click(); return "ok"; })()' >/dev/null
  tab View
  read -r x y <<<"$(js '(() => { const r = document.querySelector("canvas.vf").getBoundingClientRect(); return `${Math.round(r.left + r.width / 2)} ${Math.round(r.top + r.height / 2)}`; })()')"
  ab mouse move "$x" "$y" >/dev/null
  ab mouse down >/dev/null
  ab mouse move $((x + 60)) $((y + 20)) >/dev/null
  ab mouse move $((x + 120)) $((y + 30)) >/dev/null
  ab mouse up >/dev/null
  wait_for "$C.aimLock === 'Free'" 20
  l=$(js "$C.aimLock")
  ui=$(js "$LOCK")
  check "drag frees the lock" "$([ "$l" = Free ] && [ "$ui" = Free ] && echo 1 || echo 0)" "store $l, control $ui"
  fi=$(js "($AIM_SEC).querySelectorAll('input[type=number]').length")
  check "Free angles are inputs" "$([ "$fi" = 2 ] && echo 1 || echo 0)" "$fi inputs"
  az=$(js "$C.azimuthDeg.toFixed(2)")
  js "(() => { window.__scape.world.getState().setTime($NIGHT + 4 * 3600e3); return 'ok'; })()" >/dev/null
  sleep 0.3
  az2=$(js "$C.azimuthDeg.toFixed(2)")
  check "Free ignores the time" "$([ "$az" = "$az2" ] && echo 1 || echo 0)" "az $az -> $az2"

  ab open "$BASE/" >/dev/null
  wait_for '!!document.querySelector(".panel-inner .tablist")' 80
  js '(() => { document.querySelector(".panel-expand")?.click(); return "ok"; })()' >/dev/null
  tab Frame
  l=$(js "$LOCK")
  check "map shows Free after the drag" "$([ "$l" = Free ] && echo 1 || echo 0)" "$l"
  js "(() => { window.__scape.world.getState().setPin2(null); return 'ok'; })()" >/dev/null
  sleep 0.2
  d=$(js "(() => { const b = ($AIM_SEC).querySelector('[data-aim-lock=Target]'); return b.disabled + ' ' + b.title; })()")
  check "Target disabled without a target" "$([ "$d" = 'true Place a target location on the map first' ] && echo 1 || echo 0)" "$d"
fi

[ "$BRAVE" = 1 ] && brave_stop "$PROFILE" && rm -rf "$PROFILE"

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
