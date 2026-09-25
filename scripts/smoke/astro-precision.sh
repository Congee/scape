#!/usr/bin/env bash
# Smoke test for the precision fixes: rise/set from the sampled ground, a low sunset over the sea, the refracted Milky Way.
# Usage: scripts/smoke/astro-precision.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port and a browser with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5320}
CDP=${2:-9342}
OUT=${3:-${TMPDIR:-/tmp}/astro-precision}
BASE="http://localhost:$PORT"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PNG="$ROOT/scripts/smoke/png-sample.py"
mkdir -p "$OUT"

SESSION=${AGENT_BROWSER_SESSION:-smoke-$CDP}
ab() { agent-browser --cdp "${CDP:?no CDP port}" --session "$SESSION" "$@"; }
bun "$(dirname "$0")/reset.ts" "$CDP" "$BASE"
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

go() {
  local i
  for i in 1 2 3; do
    ab open "$1" >/dev/null 2>&1 && wait_for 'window.__scape && document.querySelector(".tabs button")' && return 0
    sleep 1
  done
  return 1
}

# A background window gets no animation frames; each screenshot forces one.
frames() { # screenshot path, count
  local i
  for ((i = 0; i < ${2:-3}; i++)); do
    ab screenshot "$1" >/dev/null
    sleep 0.3
  done
}

# Rise/set the app should report for this ground, eye height and local day.
expect_set() { # lat lng ground|null eyeM startMs endMs golden
  (cd "$ROOT" && bun -e "import { makeObserver, siteHeightM } from './src/lib/core/astro/bodies'; import { dayEvents, EventKind } from './src/lib/core/astro/dayEvents'; const e = dayEvents(makeObserver({ lat: $1, lng: $2 }, siteHeightM($3, $4)), $5, $6, { heightAboveGroundM: $4, goldenAltitude: $7 }); console.log(e.find((x) => x.body === 'Sun' && x.kind === EventKind.Set)?.time ?? 0);")
}
sun_at() { # lat lng heightM instant body → az alt
  (cd "$ROOT" && bun -e "import { makeObserver, SkyBody } from './src/lib/core/astro/bodies'; import { position } from './src/lib/core/astro/positions'; const p = position(SkyBody.$5, new Date('$4'), makeObserver({ lat: $1, lng: $2 }, $3)); console.log(p.azimuth, p.altitude);")
}

TERRAIN0=$(js 'window.__scape ? window.__scape.settings.getState().terrain : true' 2>/dev/null || echo true)
TZ0=$(js '(() => { const w = window.__scape ? window.__scape.world.getState() : null; return !w || w.tzAuto ? "null" : JSON.stringify(w.tz); })()' 2>/dev/null || echo null)
# The tz= links pin the zone, which persists; put back what the other smokes expect.
restore() {
  js "(() => { window.__scape.world.getState().setTz(${TZ0:-null}); return 'ok'; })()" >/dev/null 2>&1
  js "(() => { window.__scape.settings.getState().update({ terrain: ${TERRAIN0:-true} }); return 'ok'; })()" >/dev/null 2>&1
  ab set viewport 1400 900 >/dev/null 2>&1
}
ab set viewport 1400 900 >/dev/null

# 1. Sunset on Gornergrat: the planner's time follows the sampled ground; without terrain it is sea level.
HIGH="45.9837,7.7847"
planner_set() { # terrain on|off → "setMs groundM dayStart dayEnd golden eyeM"
  js "(() => { window.__scape.settings.getState().update({ terrain: $1 }); return 'ok'; })()" >/dev/null
  [ "$1" = true ] && wait_for 'window.__scape.terrain.getState().pinGroundM > 1000' 120
  wait_for "(() => { const d = window.__scape.dayData.getState(); const g = window.__scape.terrain.getState().pinGroundM; const k = d.key.split('|'); return !d.loading && k[0] === '${HIGH%,*}0' && k[3] === String(g == null || !$1 ? '' : Math.round(g)); })()" 120
  js '(() => { const d = window.__scape.dayData.getState(); const e = d.events.find((x) => x.body === "Sun" && x.kind === "Set"); const g = window.__scape.terrain.getState().pinGroundM; return `${e ? e.time : 0} ${g == null ? "null" : Math.round(g)} ${d.dayStart} ${d.dayEnd} ${window.__scape.settings.getState().goldenAltitude} ${window.__scape.world.getState().pinHeightM + 1.6}`; })()'
}
go "$BASE/?camera=$HIGH&t=2026-06-21T12:00Z&tz=Europe/Zurich&z=13"
read -r on_ms on_g d0 d1 gold eye <<<"$(planner_set true)"
want_on=$(expect_set "${HIGH%,*}" "${HIGH#*,}" "$on_g" "$eye" "$d0" "$d1" "$gold")
check "Gornergrat sunset on ${on_g} m ground" "$(awk -v a="$on_ms" -v b="$want_on" -v g="$on_g" 'BEGIN { d = a - b; exit !(g > 2500 && d * d < 1e6) }' && echo 1 || echo 0)" "app $(date -u -r $((on_ms / 1000)) +%T), expected $(date -u -r $((want_on / 1000)) +%T)"
read -r off_ms off_g _ _ _ _ <<<"$(planner_set false)"
want_off=$(expect_set "${HIGH%,*}" "${HIGH#*,}" null "$eye" "$d0" "$d1" "$gold")
check "Gornergrat sunset, terrain off (sea level)" "$(awk -v a="$off_ms" -v b="$want_off" 'BEGIN { d = a - b; exit !(d * d < 1e6) }' && echo 1 || echo 0)" "app $(date -u -r $((off_ms / 1000)) +%T), ground $off_g"
shift_s=$(( (off_ms - on_ms) / 1000 ))
check "thinner air at 3 km sets the sun earlier" "$([ "$shift_s" -ge 25 ] && [ "$shift_s" -le 70 ] && echo 1 || echo 0)" "${shift_s} s earlier than at sea level"
js "(() => { window.__scape.settings.getState().update({ terrain: true }); return 'ok'; })()" >/dev/null

# 2. Sunset over the Atlantic from Guincho: the refracted sun sinks smoothly through the horizon.
SEA="38.7296,-9.4745"
WEST="38.7296,-9.62"
go "$BASE/viewfinder?camera=$SEA&target=$WEST&t=2026-06-21T20:00Z&f=600"
wait_for 'window.__scape.prism && window.__scape.prism.cam' 80
worst=0 samples=""
for m in 00 02 04 06 08 10 12 14 16; do
  at="2026-06-21T20:${m}:00Z"
  js "(() => { window.__scape.world.getState().setTime(Date.parse('$at')); return 'ok'; })()" >/dev/null
  frames "$OUT/sea-scan.png" 2
  a=$(js 'window.__scape.prism.cam.sunAlt.toFixed(4)')
  read -r _ want <<<"$(sun_at "${SEA%,*}" "${SEA#*,}" 10 "$at" Sun)"
  samples+=" $a"
  worst=$(awk -v w="$worst" -v a="$a" -v b="$want" 'BEGIN { d = a - b; if (d < 0) d = -d; print (d > w ? d : w) }')
done
check "sea sunset: viewfinder sun on the refracted track" "$(awk -v w="$worst" 'BEGIN { exit !(w < 0.01) }' && echo 1 || echo 0)" "worst ${worst}°, 2-min samples:$samples"
read -r saz salt <<<"$(sun_at "${SEA%,*}" "${SEA#*,}" 10 2026-06-21T20:04:00Z Sun)"
js "(() => { window.__scape.world.getState().setTime(Date.parse('2026-06-21T20:04:00Z')); window.__scape.composition.getState().aim($saz, $salt); return 'ok'; })()" >/dev/null
sleep 1
frames "$OUT/sea-sunset-600.png" 4
box=$(js '(() => { const c = document.querySelector("canvas"); const r = c.getBoundingClientRect(); return `${devicePixelRatio} ${r.left + 4} ${r.top + 4} ${r.right - 4} ${r.bottom - 4}`; })()')
spread=$(python3 "$PNG" spread "$OUT/sea-sunset-600.png" $box)
check "sea sunset 600 mm: disc on the horizon drawn" "$(awk -v s="$spread" 'BEGIN { exit !(s > 2) }' && echo 1 || echo 0)" "sun alt $(printf %.2f "$salt")°, picture spread $spread"

# 3. Milky Way core in the Atacama at new moon: overhead at 24 mm both ways, then low where refraction lifts it.
DARK="-23.0,-67.8"
for shot in L@03:00 P@03:00 Low@09:20; do
  o=${shot%@*} at="2026-07-14T${shot#*@}:00Z"
  go "$BASE/viewfinder?camera=$DARK&t=$at&tz=America/Santiago&f=24$([ $o = P ] && echo '&o=p')"
  js "(() => { window.__scape.settings.getState().update({ terrain: false }); return 'ok'; })()" >/dev/null
  read -r gaz galt <<<"$(sun_at "${DARK%,*}" "${DARK#*,}" 0 "$at" Gc)"
  js "(() => { window.__scape.composition.getState().aim($gaz, $(awk -v a="$galt" 'BEGIN { print (a > 60 ? 60 : a < 20 ? 20 : a) }')); return 'ok'; })()" >/dev/null
  wait_for 'window.__scape.prism' 80
  sleep 1
  frames "$OUT/milkyway-24-$o.png" 4
  box=$(js '(() => { const c = document.querySelector("canvas"); const r = c.getBoundingClientRect(); return `${devicePixelRatio} ${r.left + 4} ${r.top + 4} ${r.right - 4} ${r.bottom - 4}`; })()')
  spread=$(python3 "$PNG" spread "$OUT/milkyway-24-$o.png" $box)
  check "Milky Way 24 mm $o" "$(awk -v s="$spread" 'BEGIN { exit !(s > 2) }' && echo 1 || echo 0)" "core alt $(printf %.1f "$galt")°, picture spread $spread"
done

# 4. Phone viewport over the sea sunset.
ab set viewport 390 844 >/dev/null
go "$BASE/viewfinder?camera=$SEA&target=$WEST&t=2026-06-21T20:04Z&f=200"
frames "$OUT/phone-sea.png" 3
wide=$(js 'document.documentElement.scrollWidth > window.innerWidth')
check "phone 390×844 viewfinder: no sideways page scroll" "$([ "$wide" = false ] && echo 1 || echo 0)" "overflow $wide"

restore
echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
