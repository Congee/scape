#!/usr/bin/env bash
# URL truth smoke: frame drags and map moves write the URL; a copied URL in a fresh profile reproduces them;
# back/forward and URL edits apply without reload; a sun lock in the URL follows the time.
# Usage: scripts/smoke/urltruth.sh [port] [cdp-port] [out-dir]
# Needs a dev server on the port; launches a headless Brave on the CDP port unless one answers, and stops only what it started.
# A fresh profile is a fresh origin: each `f<n>.localhost` starts with empty storage in the same browser.
set -uo pipefail

PORT=${1:-5479}
CDP=${2:-9479}
OUT=${3:-${TMPDIR:-/tmp}/urltruth}
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
yes() { "$@" && echo 1 || echo 0; }
fresh() { echo "${1/localhost:$PORT/f$RANDOM$RANDOM.localhost:$PORT}"; }
param() { js "new URLSearchParams(location.search).get('$1') ?? ''"; }

C='window.__scape.composition.getState()'
W='window.__scape.world.getState()'
SCENE="c=46.5476,7.9806&tg=46.5775,8.0053&t=2026-07-15T20:00Z&tz=Europe/Zurich&f=50"
# The frame a viewfinder shows, from the stores.
FRAME="(() => { const c = $C, w = $W; return [c.aimLock, c.azimuthDeg.toFixed(1), c.elevationDeg.toFixed(1), c.focalMm, w.pin.lat.toFixed(4) + ',' + w.pin.lng.toFixed(4), w.pin2 ? w.pin2.lat.toFixed(4) + ',' + w.pin2.lng.toFixed(4) : '-', w.live ? 'live' : new Date(w.time).toISOString().slice(0, 16)].join(' '); })()"
VIEW="(() => { const v = $W.view; return [v.center.lat.toFixed(3), v.center.lng.toFixed(3), v.zoom.toFixed(2)].join(' '); })()"
vf_ready() { wait_for '!!window.__scape?.world && !!document.querySelector("canvas.vf")' 80; }
map_ready() { wait_for '!!window.__scape?.world && !!document.querySelector(".maplibregl-canvas")' 80; }

ab set viewport 1600 1000 >/dev/null
# A hidden tab never acks input.
[ "$(js 'document.visibilityState')" = visible ] || { echo "the smoke tab is hidden" >&2; exit 1; }

# Readable URL and a VF drag.
ab open "$BASE/viewfinder?$SCENE" >/dev/null
vf_ready
sleep 1
href=$(js 'location.href')
check "URL keeps , : / literal" "$(yes [ -n "$(echo "$href" | grep -F 'c=46.5476,7.9806' | grep -F 'T20:00Z' | grep -F 'tz=Europe/Zurich')" ])" "$href"
read -r x y <<<"$(js '(() => { const r = document.querySelector("canvas.vf").getBoundingClientRect(); return `${Math.round(r.left + r.width / 2)} ${Math.round(r.top + r.height / 2)}`; })()')"
ab mouse move "$x" "$y" >/dev/null
ab mouse down >/dev/null
ab mouse move $((x + 60)) $((y + 20)) >/dev/null
ab mouse move $((x + 120)) $((y + 40)) >/dev/null
ab mouse up >/dev/null
t0=$(date +%s)
wait_for "new URLSearchParams(location.search).get('a') === 'f' && new URLSearchParams(location.search).get('az') === $C.azimuthDeg.toFixed(1).replace(/\\.0\$/, '')" 6
dt=$(($(date +%s) - t0))
check "VF drag writes a=f, az, el within ~1 s" "$(yes [ "$(param a)" = f ] && [ -n "$(param az)" ] && [ -n "$(param el)" ])" "a=$(param a) az=$(param az) el=$(param el) (${dt}s)"
frame=$(js "$FRAME")
href=$(js 'location.href')

# The copied URL in a fresh profile.
ab open "$(fresh "$href")" >/dev/null
vf_ready
sleep 0.5
frame2=$(js "$FRAME")
check "copied VF URL gives the same frame in a fresh profile" "$(yes [ "$frame" = "$frame2" ])" "$frame | $frame2 ($(js 'location.hostname'))"

# Map pan and zoom.
ab open "$BASE/?c=46.5476,7.9806&z=11" >/dev/null
map_ready
sleep 1.5
view0=$(js "$VIEW")
bun "$ROOT/scripts/smoke/mapdrag.ts" "$CDP" "$BASE" >/dev/null
wait_for "!!new URLSearchParams(location.search).get('m') && new URLSearchParams(location.search).get('z') !== null" 20
sleep 1
view=$(js "$VIEW")
m=$(param m)
z=$(param z)
check "map pan and zoom write m and z" "$(yes [ -n "$m" ] && [ -n "$z" ] && [ "$(param c)" = 46.5476,7.9806 ] && [ "$view" != "$view0" ])" "m=$m z=$z ($view0 → $view)"
href=$(js 'location.href')
ab open "$(fresh "$href")" >/dev/null
map_ready
sleep 1.5
check "copied map URL reproduces the view in a fresh profile" "$(yes [ "$(param m)" = "$m" ] && [ "$(param z)" = "$z" ] && [ "$(js "$VIEW")" = "$view" ])" "m=$(param m) z=$(param z) ($(js "$VIEW"))"

# Map → VF → Esc carries the scene.
js "(() => { document.querySelector('a.rail-link[href^=\"/viewfinder\"]').click(); return 'ok'; })()" >/dev/null
vf_ready
sleep 0.3
check "map → VF link carries the scene" "$(yes [ "$(param c)" = 46.5476,7.9806 ] && [ "$(param m)" = "$m" ])" "$(js 'location.search')"
ab press Escape >/dev/null
map_ready
sleep 0.3
check "VF Esc carries the scene back" "$(yes [ "$(param c)" = 46.5476,7.9806 ] && [ "$(param m)" = "$m" ] && [ "$(js "$VIEW")" = "$view" ])" "$(js 'location.search')"

# Back/forward and a URL edit, without reload.
ab open "$BASE/viewfinder?$SCENE" >/dev/null
vf_ready
sleep 1
js '(() => { window.__noReload = 1; return "ok"; })()' >/dev/null
js "(() => { history.pushState(history.state, '', location.pathname + location.search.replace('f=50', 'f=200')); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); return 'ok'; })()" >/dev/null
wait_for "$C.focalMm === 200" 12
f1=$(js "$C.focalMm")
js '(() => { history.back(); return "ok"; })()' >/dev/null
wait_for "$C.focalMm === 50" 12
f2=$(js "$C.focalMm")
js '(() => { history.forward(); return "ok"; })()' >/dev/null
wait_for "$C.focalMm === 200" 12
f3=$(js "$C.focalMm")
nr=$(js 'window.__noReload === 1')
check "URL edit, back and forward apply without reload" "$(yes [ "$f1 $f2 $f3 $nr" = '200 50 200 true' ])" "f $f1 → back $f2 → forward $f3, same page $nr"

# A sun lock follows the time.
ab open "$BASE/viewfinder?c=46.5476,7.9806&a=s&t=2026-07-15T08:00Z&tz=Europe/Zurich" >/dev/null
vf_ready
sleep 1
a0=$(js "$C.azimuthDeg.toFixed(1)")
js "(() => { history.pushState(history.state, '', location.pathname + location.search.replace('T08:00Z', 'T11:00Z')); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); return 'ok'; })()" >/dev/null
wait_for "$C.azimuthDeg.toFixed(1) !== '$a0'" 12
a1=$(js "$C.azimuthDeg.toFixed(1)")
js "(() => { $W.setTime(Date.parse('2026-07-15T14:00Z')); return 'ok'; })()" >/dev/null
wait_for "new URLSearchParams(location.search).get('t') === '2026-07-15T14:00Z'" 12
a2=$(js "$C.azimuthDeg.toFixed(1)")
lock=$(js "$C.aimLock")
check "sun lock in the URL stays locked and follows the time" "$(yes [ "$lock" = Sun ] && [ "$(param a)" = s ] && [ -z "$(param az)" ] && [ "$a0" != "$a1" ] && [ "$a1" != "$a2" ])" "$lock a=$(param a) az $a0 → $a1 → $a2, t=$(param t)"

[ "$BRAVE" = 1 ] && brave_stop "$PROFILE" && rm -rf "$PROFILE"

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
exit $((FAILS > 0))
