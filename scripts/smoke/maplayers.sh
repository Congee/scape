#!/usr/bin/env bash
# Map layers smoke: day/night, elevation, slope and aspect toggle with legends, the night edge meets the Timeline sunrise, no DEM seams, idle is quiet.
# Usage: scripts/smoke/maplayers.sh [port] [cdp-port] [screenshot-dir] [brave-profile|-] [gpu-timing-lock-dir]
# Needs a dev server on the port and a background browser with remote debugging on the CDP port; CPU is measured only with a profile.
set -uo pipefail

PORT=${1:-5443}
CDP=${2:-9443}
OUT=${3:-${TMPDIR:-/tmp}/maplayers}
PROFILE=${4:--}
LOCK=${5:-${TMPDIR:-/tmp}/gpu-timing.lock}
BASE="http://localhost:$PORT"
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PNG="$ROOT/scripts/smoke/png-sample.py"
mkdir -p "$OUT"

SESSION=${AGENT_BROWSER_SESSION:-smoke-$CDP}
ab() { agent-browser --cdp "${CDP:?no CDP port}" --session "$SESSION" "$@"; }
js() { ab eval "$1" | sed -e 's/^"//' -e 's/"$//' -e 's/\\"/"/g'; }
ok() { awk "BEGIN { exit !($1) }" && echo 1 || echo 0; }

FAILS=0
ROWS=()
check() { # name, ok (0/1), detail
  local status=PASS
  if [ "$2" != 1 ]; then status=FAIL; FAILS=$((FAILS + 1)); fi
  ROWS+=("| $1 | $status | $3 |")
}

ZERMATT="45.9763,7.6586"
# Zuidplaspolder by Rotterdam, about 6 m below sea level.
ROTTERDAM="52.0050,4.6200"
TROMSO="69.6492,18.9553"
DATELINE="0,179.9"
DAY="2026-06-21T10:00Z"
OFF='{ showDayNight: false, showElevation: false, showSlope: false, showAspect: false, terrain: true, terrain3d: false }'

wait_for() { # js condition, tries of 0.25 s
  local i
  for ((i = 0; i < ${2:-40}; i++)); do
    [ "$(js "!!($1)")" = true ] && return 0
    sleep 0.25
  done
  return 1
}
settle() { wait_for '(() => { const m = window.__scapeMap; return m && m.loaded() && m.areTilesLoaded(); })()' "${1:-120}"; sleep 0.5; }
set_s() { js "(() => { window.__scape.settings.getState().update($1); return 'ok'; })()" >/dev/null; }

go() { # camera, zoom, time
  local i
  for i in 1 2 3; do
    ab open "$BASE/?camera=$1&z=$2&t=$3" >/dev/null 2>&1 && wait_for 'window.__scape && window.__scapeMap && window.__scapeMap.isStyleLoaded()' 80 && settle && return 0
    sleep 1
  done
  return 1
}

quiet() { # fewest rAF/timers over up to three 3 s windows, so late tile loads do not count
  local best="" i n
  for i in 1 2 3; do
    js '(() => { window.__scape.idle.reset(); return "ok"; })()' >/dev/null
    sleep 3
    n=$(js '(() => { const p = window.__scape.idle; return `${p.raf} ${p.timers}`; })()')
    if [ -z "$best" ] || [ "${n% *}" -lt "${best% *}" ]; then best=$n; fi
    [ "${best% *}" = 0 ] && break
  done
  echo "$best"
}

tab() { js "(() => { const u = window.__scape.ui.getState(); u.setPanelTab('$1'); u.setPanelCollapsed(false); return 'ok'; })()" >/dev/null; }
legend() { js '(() => document.querySelector(".map-legend")?.textContent ?? "")()'; }
has_layer() { js "!!window.__scapeMap.getLayer('$1')"; }
# Night caps at a point: -1 when off screen.
caps() { js "(() => { const m = window.__scapeMap, p = m.project($1); if (p.x < 0 || p.y < 0 || p.x > m.getCanvas().clientWidth || p.y > m.getCanvas().clientHeight) return -1; return new Set(m.queryRenderedFeatures(p, { layers: ['daynight-fill'] }).map((f) => f.properties.band)).size; })()"; }
pin_caps() { caps 'window.__scape.world.getState().pin'; }

LAYERS=(DayNight Elevation Slope Aspect)
setting() { case $1 in DayNight) echo showDayNight ;; Elevation) echo showElevation ;; Slope) echo showSlope ;; Aspect) echo showAspect ;; esac; }
layer_id() { case $1 in DayNight) echo daynight-fill ;; Elevation) echo elevation-tint ;; Slope) echo slope-tint ;; Aspect) echo aspect-tint ;; esac; }
legend_key() { case $1 in DayNight) echo Astronomical ;; Elevation) echo 5,000 ;; Slope) echo '45°+' ;; Aspect) echo Facing ;; esac; }

toggles() { # site tag, camera, zoom, viewport tag
  go "$2" "$3" "$DAY" || { check "$4 $1: page loads" 0 "no map"; return; }
  set_s "$OFF"
  settle
  ab screenshot "$OUT/$4-$1-none.png" >/dev/null
  local l
  for l in "${LAYERS[@]}"; do
    local s id key
    s=$(setting "$l"); id=$(layer_id "$l"); key=$(legend_key "$l")
    set_s "{ $s: true }"
    settle
    ab screenshot "$OUT/$4-$1-$l.png" >/dev/null
    local on leg; on=$(has_layer "$id"); leg=$(legend)
    check "$4 $1 $l on: layer and legend" "$([ "$on" = true ] && [[ $leg == *"$key"* ]] && echo 1 || echo 0)" "layer $on, legend '${leg:0:60}'"
    set_s "{ $s: false }"
    settle
    on=$(has_layer "$id"); leg=$(legend)
    check "$4 $1 $l off: layer and legend gone" "$([ "$on" = false ] && [ -z "$leg" ] && echo 1 || echo 0)" "layer $on, legend '${leg:0:40}'"
  done
}

land_check() { # viewport tag: below-sea-level Mapterhorn ground is tinted as land, not water
  go "$ROTTERDAM" 13 "$DAY"
  set_s "$OFF"
  set_s '{ showElevation: true, elevationOpacity: 1 }'
  settle
  local e rgb
  e=$(js '(() => Math.round(window.__scapeMap.queryTerrainElevation?.(window.__scape.world.getState().pin) ?? window.__scape.terrain.getState().pinGroundM ?? NaN))()')
  ab screenshot "$OUT/$1-rotterdam-polder-elevation.png" >/dev/null
  rgb=$(js '(() => { const m = window.__scapeMap, c = m.getCanvas(), gl = m.painter.context.gl, p = m.project(window.__scape.world.getState().pin), d = devicePixelRatio, px = new Uint8Array(4); m.redraw(); gl.readPixels(Math.round((p.x + 40) * d), Math.round(c.height - (p.y + 40) * d), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return [...px.slice(0, 3)].join(" "); })()')
  read -r r g b <<<"$rgb"
  check "$1 Rotterdam polder: below sea level reads as land" "$(ok "${g:-0} > ${b:-255}")" "pin ground ${e} m, map rgb $rgb near the pin"
}

dawn() { # viewport tag: the night edge crosses the pin at the Timeline sunrise, within seconds
  go "$ZERMATT" 10 "2026-06-21T02:00Z"
  set_s "$OFF"
  set_s '{ showDayNight: true }'
  wait_for '(() => { const d = window.__scape.dayData.getState(); return !d.loading && d.events.some((e) => e.body === "Sun" && e.kind === "Rise"); })()' 80
  local rise; rise=$(js '(() => window.__scape.dayData.getState().events.find((e) => e.body === "Sun" && e.kind === "Rise")?.time ?? 0)()')
  local out="" dt n pass=1
  for dt in -5 -2 2 5; do
    js "(() => { window.__scape.world.getState().setTime($rise + $dt * 1000); return 'ok'; })()" >/dev/null
    settle 40
    n=$(pin_caps)
    out+="$dt s: $n; "
    if [ "$dt" -lt 0 ]; then [ "$n" -ge 1 ] || pass=0; else [ "$n" = 0 ] || pass=0; fi
  done
  check "$1 dawn: pin in night before, day after the Timeline sunrise" "$pass" "sunrise $(date -u -r $((rise / 1000)) +%H:%M:%SZ); caps at ${out% ; }"
  js '(() => { window.__scapeMap.jumpTo({ zoom: 3.5 }); return "ok"; })()' >/dev/null
  local m
  for m in -90 -30 0 30; do
    js "(() => { window.__scape.world.getState().setTime($rise + $m * 60000); return 'ok'; })()" >/dev/null
    settle 40
    ab screenshot "$OUT/$1-dawn-scrub-${m}min.png" >/dev/null
  done
  js "(() => { window.__scape.world.getState().setTime($rise); return 'ok'; })()" >/dev/null
  settle 40
  local q; q=$(quiet)
  check "$1 dawn idle 3 s: 0 rAF with day/night on" "$([ "${q% *}" = 0 ] && echo 1 || echo 0)" "rAF/timers $q"
}

polar() { # viewport tag
  go "$TROMSO" 5 "2026-06-21T23:00Z"
  set_s "$OFF"
  set_s '{ showDayNight: true }'
  settle
  local n; n=$(pin_caps)
  ab screenshot "$OUT/$1-tromso-polar-day.png" >/dev/null
  check "$1 Tromsø 21 Jun 23:00Z: midnight sun, no night at the pin" "$([ "$n" = 0 ] && echo 1 || echo 0)" "$n caps"
  js "(() => { window.__scape.world.getState().setTime(Date.parse('2026-12-21T11:00Z')); return 'ok'; })()" >/dev/null
  settle
  n=$(pin_caps)
  ab screenshot "$OUT/$1-tromso-polar-night.png" >/dev/null
  check "$1 Tromsø 21 Dec 11:00Z: polar noon is civil twilight" "$([ "$n" = 1 ] && echo 1 || echo 0)" "$n caps"
}

antimeridian() { # viewport tag
  go "$DATELINE" 3 "2026-06-21T06:00Z" # dusk terminator crosses 180° near the equator
  set_s "$OFF"
  set_s '{ showDayNight: true }'
  settle
  ab screenshot "$OUT/$1-antimeridian.png" >/dev/null
  local lat w e pass=1 out="" seen=""
  for lat in -15 -8 0 8 15; do
    w=$(caps "[179.95, $lat]"); e=$(caps "[180.05, $lat]")
    out+="${lat}°: $w/$e; "
    [ "$w" = "$e" ] || pass=0
    [ "$w" = -1 ] || seen+="$w "
  done
  [ "$(wc -w <<<"$seen")" -ge 3 ] || pass=0
  [ "$(tr ' ' '\n' <<<"$seen" | sort -u | grep -c .)" -gt 1 ] || pass=0 # the terminator crosses the line
  check "$1 antimeridian: same caps either side of ±180°" "$pass" "${out% ; }"
}

seams() { # viewport tag: no step in slope or aspect across a DEM tile edge
  local l
  for l in Slope Aspect; do
    go "$ZERMATT" 13 "$DAY"
    set_s "$OFF"
    set_s "{ show$l: true, $(echo "$l" | tr A-Z a-z)Opacity: 1 }"
    settle
    # Centre the map on a DEM tile corner so both edges cross the middle.
    js "(() => { const m = window.__scapeMap, tm = m.style.tileManagers['terrain-dem-hillshade'], z = tm.getVisibleCoordinates()[0].canonical.z, n = 2 ** z, c = m.getCenter(); const x = Math.round(((c.lng + 180) / 360) * n), yM = (1 - Math.log(Math.tan(Math.PI / 4 + (c.lat * Math.PI) / 360)) / Math.PI) / 2, y = Math.round(yM * n); m.jumpTo({ center: [(x / n) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI] }); return 'ok'; })()" >/dev/null
    settle
    ab screenshot "$OUT/$1-seam-$l.png" >/dev/null
    local geo; geo=$(js '(() => { const m = window.__scapeMap, r = m.getContainer().getBoundingClientRect(), p = m.project(m.getCenter()); return [devicePixelRatio, r.left + p.x, r.top + p.y, r.left + 30, r.right - 30, r.top + 30, r.bottom - 120].map((v) => v.toFixed(2)).join(" "); })()')
    read -r d cx cy x0 x1 y0 y1 <<<"$geo"
    local vx vy
    vx=$(python3 "$PNG" seam "$OUT/$1-seam-$l.png" "$d" x "$cx" "$y0" "$y1")
    vy=$(python3 "$PNG" seam "$OUT/$1-seam-$l.png" "$d" y "$cy" "$x0" "$x1")
    check "$1 $l: no seam across a DEM tile edge" "$(ok "${vx%% *} < 2 && ${vy%% *} < 2")" "step ratio x ${vx%% *} (${vx#* }), y ${vy%% *} (${vy#* })"
  done
}

three_d() { # viewport tag: day/night drapes on 3D terrain; slope and aspect say they are flat-map only
  go "$ZERMATT" 12 "2026-06-21T03:40Z"
  set_s "$OFF"
  set_s '{ showDayNight: true, showElevation: true, showSlope: true, terrain3d: true }'
  js '(() => { window.__scapeMap.jumpTo({ pitch: 60, bearing: 200 }); return "ok"; })()' >/dev/null
  settle
  tab Map
  sleep 0.5
  ab screenshot "$OUT/$1-3d.png" >/dev/null
  local s hint; s=$(has_layer slope-tint)
  hint=$(js '(() => document.body.textContent.includes("Shown on the flat map only"))()')
  check "$1 3D: day/night and elevation on, slope hidden with a hint" "$([ "$(has_layer daynight-fill)" = true ] && [ "$(has_layer elevation-tint)" = true ] && [ "$s" = false ] && [ "$hint" = true ] && echo 1 || echo 0)" "slope layer $s, hint $hint"
  set_s '{ terrain3d: false }'
}

all_on() { # viewport tag: every layer on, idle and layout
  go "$ZERMATT" 12 "$DAY"
  set_s '{ showDayNight: true, showElevation: true, showSlope: true, showAspect: true, terrain: true, terrain3d: false }'
  tab Map
  settle
  ab screenshot "$OUT/$1-all-layers.png" >/dev/null
  local q; q=$(quiet)
  check "$1 all layers idle 3 s: 0 rAF" "$([ "${q% *}" = 0 ] && echo 1 || echo 0)" "rAF/timers $q"
  local fit; fit=$(js '(() => { const r = document.querySelector(".map-legend")?.getBoundingClientRect(); return r ? `${Math.round(r.left)}-${Math.round(r.right)} of ${innerWidth}` : "none"; })()')
  local inside; inside=$(js '(() => { const r = document.querySelector(".map-legend")?.getBoundingClientRect(); return !!r && r.left >= 0 && r.right <= innerWidth; })()')
  check "$1 legend inside the viewport" "$([ "$inside" = true ] && echo 1 || echo 0)" "legend x $fit"
  local wide; wide=$(js 'document.documentElement.scrollWidth > window.innerWidth')
  check "$1 Layers tab: no sideways page scroll" "$([ "$wide" = false ] && echo 1 || echo 0)" "overflow $wide"
}

cpu_s() { # this profile's renderer CPU seconds
  ps -axo time=,command= | awk -v p="--user-data-dir=$PROFILE" 'index($0, p) && /--type=renderer/ { n = split($1, t, ":"); s = t[n]; if (n > 1) s += t[n - 1] * 60; if (n > 2) s += t[n - 2] * 3600; sum += s } END { printf "%.2f", sum }'
}
cpu() { # per-layer idle renderer CPU over 10 s, holding the GPU timing lock per measurement
  [ "$PROFILE" = - ] && return
  go "$ZERMATT" 12 "$DAY"
  local l
  for l in none "${LAYERS[@]}"; do
    set_s "$OFF"
    [ "$l" = none ] || set_s "{ $(setting "$l"): true }"
    settle
    sleep 2
    until mkdir "$LOCK" 2>/dev/null; do sleep 30; done
    local a b; a=$(cpu_s); sleep 10; b=$(cpu_s)
    rmdir "$LOCK"
    local pct; pct=$(awk "BEGIN { printf \"%.1f\", ($b - $a) * 10 }")
    check "idle renderer CPU, $l on" "$(ok "$pct <= 2")" "$pct % of a core over 10 s"
  done
  set_s "$OFF"
}

for vp in desktop phone; do
  if [ $vp = desktop ]; then ab set viewport 1400 900 >/dev/null; else ab set viewport 390 844 >/dev/null; fi
  toggles zermatt "$ZERMATT" 13 $vp
  toggles rotterdam "$ROTTERDAM" 13 $vp
  land_check $vp
  dawn $vp
  polar $vp
  antimeridian $vp
  seams $vp
  three_d $vp
  all_on $vp
done
ab set viewport 1400 900 >/dev/null
cpu

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
