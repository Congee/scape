#!/usr/bin/env bash
# Layers tab smoke: one map type at a time, every map layer on and off over two map types, the cloud switch shared with the Weather tab, choices survive a reload, the phone cloud legend folds, idle is quiet.
# Usage: scripts/smoke/layerstab.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port; launches a headless Brave on the CDP port unless one answers, and stops only what it started.
set -uo pipefail

PORT=${1:-5449}
CDP=${2:-9449}
OUT=${3:-${TMPDIR:-/tmp}/layerstab}
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
yes() { [ "$1" = true ] && echo 1 || echo 0; }

wait_for() { # js condition, tries of 0.25 s
  local i
  for ((i = 0; i < ${2:-40}; i++)); do
    [ "$(js "!!($1)")" = true ] && return 0
    sleep 0.25
  done
  return 1
}
styled() { wait_for '(() => { const m = window.__scapeMap; return m && m.isStyleLoaded(); })()' "${1:-80}"; sleep 0.3; }

ZERMATT="45.9763,7.6586"
DAY="2026-06-21T10:00Z"
# Every layer off, weather allowed, so each switch starts from a known state.
OFF='{ showDayNight: false, showElevation: false, showSlope: false, showAspect: false, showHillshade: false, terrain3d: false, showBuildings: false, showSunShadows: false, showLightPollution: false, showEventLines: false, showLiveLines: false, showShadow: false, showGc: false, terrain: true, weather: true }'

go() {
  local i
  for i in 1 2 3; do
    ab open "$BASE/?camera=$ZERMATT&z=12&t=$DAY" >/dev/null 2>&1 && wait_for 'window.__scape && window.__scapeMap' 80 && styled && return 0
    sleep 1
  done
  return 1
}
reload() { ab reload >/dev/null 2>&1; wait_for 'window.__scape && window.__scapeMap' 80 && styled; }
tab() { js "(() => { const u = window.__scape.ui.getState(); u.setPanelTab('$1'); u.setPanelCollapsed(false); return 'ok'; })()" >/dev/null; sleep 0.3; }
set_s() { js "(() => { window.__scape.settings.getState().update($1); return 'ok'; })()" >/dev/null; }
open_tree() { js '(() => { document.querySelectorAll(".layers .tree details").forEach((d) => { if (!d.querySelector("input[type=url]")) d.open = true; }); return "ok"; })()' >/dev/null; }

quiet() { # fewest rAF/timers over up to three 3 s windows
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

# Layer key: the data-layer of its row; state and map probes per layer.
LAYERS=(showDayNight cloud showElevation showSlope showAspect showHillshade terrain3d showBuildings showSunShadows showLightPollution showEventLines showLiveLines showShadow showGc)
state_js() { [ "$1" = cloud ] && echo "window.__scape.weather.getState().layer !== 'Off'" || echo "window.__scape.settings.getState().$1"; }
map_js() {
  case $1 in
    showDayNight) echo "!!window.__scapeMap.getLayer('daynight-fill')" ;;
    showElevation) echo "!!window.__scapeMap.getLayer('elevation-tint')" ;;
    showSlope) echo "!!window.__scapeMap.getLayer('slope-tint')" ;;
    showAspect) echo "!!window.__scapeMap.getLayer('aspect-tint')" ;;
    showHillshade) echo "!!window.__scapeMap.getLayer('hillshade')" ;;
    showLightPollution) echo "!!window.__scapeMap.getLayer('night-lights')" ;;
    showSunShadows) echo "!!window.__scapeMap.getLayer('sun-shadow')" ;;
    terrain3d) echo "!!window.__scapeMap.getTerrain()" ;;
    cloud) echo "!!document.querySelector('.cloud-legend')" ;;
    *) echo "$(state_js "$1")" ;;
  esac
}
has_opts() { case $1 in showDayNight | cloud | showElevation | showSlope | showAspect | terrain3d | showBuildings | showSunShadows | showShadow) echo 1 ;; *) echo 0 ;; esac; }
click_layer() { js "(() => { const i = document.querySelector('.layer-row[data-layer=\"$1\"] > label input'); if (!i) return 'none'; i.click(); return 'ok'; })()"; }

vp() { if [ "$1" = desktop ]; then ab set viewport 1400 900 >/dev/null; else ab set viewport 390 844 >/dev/null; fi; sleep 0.3; }

vp desktop
go || { echo "page did not load"; exit 1; }
js '(() => { window.__scape.weather.getState().setLayer("Off"); return "ok"; })()' >/dev/null
set_s "$OFF"
tab Map
open_tree
ab screenshot "$OUT/desktop-layers-none.png" >/dev/null

# Map types: each radio, only one on.
N=$(js 'document.querySelectorAll(".layers input[name=basemap]").length')
detail=""
pass=1
for ((i = 0; i < N; i++)); do
  js "(() => { document.querySelectorAll('.layers input[name=basemap]')[$i].click(); return 'ok'; })()" >/dev/null
  styled
  r=$(js "(() => { const i = [...document.querySelectorAll('.layers input[name=basemap]')]; const on = i.filter((x) => x.checked); return \`\${on.length} \${on[0] === i[$i]} \${window.__scape.settings.getState().basemapId}\`; })()")
  read -r cnt self id <<<"$r"
  detail+="$id "
  [ "$cnt" = 1 ] && [ "$self" = true ] || pass=0
done
check "map types: each of $N selectable, exactly one checked" "$pass" "${detail% }"

# Layers over two map types.
for MAP in ofm-liberty opentopo; do
  set_s "{ basemapId: '$MAP' }"
  styled
  tab Map
  for l in "${LAYERS[@]}"; do
    c=$(click_layer "$l")
    sleep 0.6
    on=$(js "$(state_js "$l")"); probe=$(js "$(map_js "$l")")
    opts=$(js "!!document.querySelector('.layer-row[data-layer=\"$l\"] > .layer-opts')")
    base=$(js "window.__scape.settings.getState().basemapId === '$MAP'")
    want_opts=$([ "$(has_opts "$l")" = 1 ] && echo true || echo false)
    check "$MAP $l on" "$([ "$c" = ok ] && [ "$on" = true ] && [ "$probe" = true ] && [ "$opts" = "$want_opts" ] && [ "$base" = true ] && echo 1 || echo 0)" "state $on, map $probe, options $opts, map type kept $base"
    [ "$MAP" = opentopo ] && [ "$l" = showElevation ] && ab screenshot "$OUT/desktop-opentopo-elevation.png" >/dev/null
    click_layer "$l" >/dev/null
    sleep 0.6
    on=$(js "$(state_js "$l")"); probe=$(js "$(map_js "$l")")
    gone=$([ "$(map_js "$l")" = "$(state_js "$l")" ] && echo "$on" || echo "$probe")
    check "$MAP $l off" "$([ "$on" = false ] && [ "$gone" = false ] && echo 1 || echo 0)" "state $on, map $probe"
  done
done
set_s "{ basemapId: 'ofm-liberty' }"
styled

# Cloud switch shared with the Weather tab.
tab Map
click_layer cloud >/dev/null
tab Weather
w=$(js '(() => document.querySelector("select[aria-label=\"Map cloud layer\"]")?.value ?? "none")()')
check "cloud on in Layers shows in Weather" "$([ "$w" != Off ] && [ "$w" != none ] && echo 1 || echo 0)" "Weather picker $w"
js '(() => { const s = document.querySelector("select[aria-label=\"Map cloud layer\"]"); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(s, "Fog"); s.dispatchEvent(new Event("change", { bubbles: true })); return "ok"; })()' >/dev/null
tab Map
r=$(js '(() => `${document.querySelector(".layer-row[data-layer=cloud] > label input").checked} ${document.querySelector("select[aria-label=\"Cloud layer kind\"]")?.value}`)()')
check "Fog picked in Weather shows in Layers" "$([ "$r" = "true Fog" ] && echo 1 || echo 0)" "checkbox, kind: $r"
ab screenshot "$OUT/desktop-layers-cloud.png" >/dev/null
click_layer cloud >/dev/null
tab Weather
w=$(js '(() => document.querySelector("select[aria-label=\"Map cloud layer\"]")?.value ?? "none")()')
check "cloud off in Layers shows Off in Weather" "$([ "$w" = Off ] && echo 1 || echo 0)" "Weather picker $w"
js '(() => { const s = document.querySelector("select[aria-label=\"Map cloud layer\"]"); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(s, "Low"); s.dispatchEvent(new Event("change", { bubbles: true })); return "ok"; })()' >/dev/null
tab Map
r=$(js '(() => `${document.querySelector(".layer-row[data-layer=cloud] > label input").checked} ${document.querySelector("select[aria-label=\"Cloud layer kind\"]")?.value}`)()')
check "Low picked in Weather turns Layers on" "$([ "$r" = "true Low" ] && echo 1 || echo 0)" "checkbox, kind: $r"
click_layer cloud >/dev/null
click_layer cloud >/dev/null
r=$(js 'window.__scape.weather.getState().layer')
check "off then on in Layers brings back Low" "$([ "$r" = Low ] && echo 1 || echo 0)" "layer $r"

# Persisted choices survive a reload.
set_s "{ basemapId: 'opentopo' }"
styled
click_layer showSlope >/dev/null
click_layer showDayNight >/dev/null
reload
tab Map
r=$(js '(() => { const s = window.__scape.settings.getState(), w = window.__scape.weather.getState(), c = (k) => document.querySelector(`.layer-row[data-layer=${k}] > label input`)?.checked; const radio = [...document.querySelectorAll(".layers input[name=basemap]")].filter((i) => i.checked).length; return `${s.basemapId} ${s.showSlope} ${s.showDayNight} ${w.layer} ${c("showSlope")} ${c("showDayNight")} ${c("cloud")} ${radio}`; })()')
check "reload keeps map type, layers and cloud kind" "$([ "$r" = "opentopo true true Low true true true 1" ] && echo 1 || echo 0)" "$r"
ab screenshot "$OUT/desktop-layers-reloaded.png" >/dev/null
q=$(quiet)
check "desktop idle 3 s with layers and cloud on: 0 rAF" "$([ "${q% *}" = 0 ] && echo 1 || echo 0)" "rAF/timers $q"
dfold=$(js '!!document.querySelector(".cloud-legend .fold, button.cloud-legend")')
check "desktop cloud legend: full, no fold control" "$([ "$dfold" = false ] && [ "$(js '!!document.querySelector(".cloud-legend .scale")')" = true ] && echo 1 || echo 0)" "fold control $dfold"

# Phone: the cloud legend folds, folded by default, remembered.
set_s "{ showSlope: false, showDayNight: false, basemapId: 'ofm-liberty' }"
js '(() => { const u = JSON.parse(localStorage.getItem("scape.ui")); delete u.state.cloudLegendOpen; localStorage.setItem("scape.ui", JSON.stringify(u)); return "ok"; })()' >/dev/null
vp phone
reload
js '(() => { window.__scape.ui.getState().setPanelCollapsed(true); return "ok"; })()' >/dev/null
sleep 0.5
h=$(js '(() => { const e = document.querySelector(".cloud-legend"); return e ? `${e.tagName} ${Math.round(e.getBoundingClientRect().height)} ${!!e.querySelector(".scale")}` : "none"; })()')
map_h=$(js 'Math.round(document.querySelector(".map-area").getBoundingClientRect().height)')
read -r tag hf scale <<<"$h"
check "phone legend folded by default" "$([ "$tag" = BUTTON ] && [ "$scale" = false ] && echo 1 || echo 0)" "$tag ${hf} px of a ${map_h} px map"
ab screenshot "$OUT/phone-legend-folded.png" >/dev/null
js '(() => { document.querySelector("button.cloud-legend").click(); return "ok"; })()' >/dev/null
sleep 0.3
h=$(js '(() => { const e = document.querySelector(".cloud-legend"); return `${e.tagName} ${Math.round(e.getBoundingClientRect().height)} ${!!e.querySelector(".scale")} ${document.documentElement.scrollWidth > innerWidth}`; })()')
read -r tag he scale wide <<<"$h"
check "phone legend expands, no sideways scroll" "$([ "$tag" = DIV ] && [ "$scale" = true ] && [ "$wide" = false ] && echo 1 || echo 0)" "${he} px open vs ${hf} px folded, overflow $wide"
ab screenshot "$OUT/phone-legend-open.png" >/dev/null
reload
js '(() => { window.__scape.ui.getState().setPanelCollapsed(true); return "ok"; })()' >/dev/null
sleep 0.5
r=$(js '!!document.querySelector("div.cloud-legend .scale")')
check "phone legend stays open after a reload" "$(yes "$r")" "open $r"
js '(() => { document.querySelector(".cloud-legend .fold").click(); return "ok"; })()' >/dev/null
sleep 0.3
r=$(js '`${!!document.querySelector("button.cloud-legend")} ${document.documentElement.scrollWidth > innerWidth}`')
check "phone legend folds again, no sideways scroll" "$([ "$r" = "true false" ] && echo 1 || echo 0)" "folded, overflow: $r"
tab Map
set_s '{ showElevation: true }'
open_tree
sleep 0.5
wide=$(js 'document.documentElement.scrollWidth > window.innerWidth')
check "phone Layers tab: no sideways scroll" "$([ "$wide" = false ] && echo 1 || echo 0)" "overflow $wide"
ab screenshot "$OUT/phone-layers.png" >/dev/null
js '(() => { window.__scape.ui.getState().setPanelCollapsed(true); return "ok"; })()' >/dev/null
q=$(quiet)
check "phone idle 3 s: 0 rAF" "$([ "${q% *}" = 0 ] && echo 1 || echo 0)" "rAF/timers $q"

# Every legend at once: stacked, none overlap, all inside the map.
legends() { # viewport
  vp "$1"
  set_s "{ ...$OFF, showDayNight: true, showElevation: true, showSlope: true, showAspect: true }"
  js '(() => { window.__scape.weather.getState().setLayer("Total"); const u = window.__scape.ui.getState(); u.setCloudLegendOpen(true); u.setPanelCollapsed(true); return "ok"; })()' >/dev/null
  wait_for '!!document.querySelector(".map-legend") && !!document.querySelector("div.cloud-legend")' 40
  sleep 0.5
  local r
  r=$(js '(() => { const a = document.querySelector(".map-area").getBoundingClientRect(), top = [...document.querySelectorAll(".map-legend, .cloud-legend")].map((e) => e.getBoundingClientRect()); const out = top.filter((b) => b.left < a.left - 0.5 || b.top < a.top - 0.5 || b.right > a.right + 0.5 || b.bottom > a.bottom + 0.5).length; let hit = 0; for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) { const p = top[i], q = top[j]; if (p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom) hit++; } return `${top.length} ${hit} ${out} ${document.documentElement.scrollWidth > innerWidth}`; })()')
  local n hit out wide
  read -r n hit out wide <<<"$r"
  check "$1 all legends: none overlap" "$([ "$n" = 2 ] && [ "$hit" = 0 ] && echo 1 || echo 0)" "$n boxes, $hit overlaps"
  check "$1 all legends: inside the map" "$([ "$out" = 0 ] && echo 1 || echo 0)" "$out outside"
  check "$1 all legends: no sideways scroll" "$([ "$wide" = false ] && echo 1 || echo 0)" "overflow $wide"
  ab screenshot "$OUT/$1-legends.png" >/dev/null
}
legends phone
legends desktop

# Leave the profile as found.
set_s "$OFF"
set_s "{ basemapId: 'ofm-liberty', showEventLines: true, showLiveLines: true, showShadow: true, showGc: true, showBuildings: true, showSunShadows: true }"
js '(() => { window.__scape.weather.getState().setLayer("Off"); return "ok"; })()' >/dev/null
vp desktop
[ "$BRAVE" = 1 ] && brave_stop "$PROFILE" && rm -rf "$PROFILE"

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
