#!/usr/bin/env bash
# Tabs smoke: Now, Shot, Sky, Find, Weather, Map|View, Markers on both pages; Aim heads Now; secondaries are collapsed rows that open;
# map-only controls absent on the viewfinder; shared settings share one widget; one "no forecast"; legacy panelTabs migrate.
# Usage: scripts/smoke/tabs.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port; launches a headless Brave on the CDP port unless one answers, and stops only what it started.
set -uo pipefail

PORT=${1:-5475}
CDP=${2:-9475}
OUT=${3:-${TMPDIR:-/tmp}/tabs}
BASE="http://localhost:$PORT"
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
. "$ROOT/scripts/smoke/brave.sh"
mkdir -p "$OUT"
PROFILE="$OUT/brave-profile"
Q='camera=46.5476,7.9806&target=46.5775,8.0053&t=2026-07-15T22:00Z'

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
go() { # path
  ab open "$BASE$1" >/dev/null
  wait_for 'window.__scape && document.querySelector("[role=tablist]")' 80
}
tab() { js "(() => { const u = window.__scape.ui.getState(); u.setPanelTab('$1'); u.setPanelCollapsed(false); return 'ok'; })()" >/dev/null; sleep 0.4; }
names() { js '(() => { const t = [...document.querySelectorAll(".tablist [role=tab]")]; return `${new Set(t.map((b) => b.offsetTop)).size} ${t.map((b) => b.textContent).join(",")}`; })()'; }
has() { js "!!document.querySelector('#ptabpanel $1')"; }
text() { js "[...document.querySelectorAll('#ptabpanel $1')].some((e) => e.textContent.trim() === '$2')"; }
# "<closed> <total>" of the open tab's collapsed rows with this id prefix.
discs() { js "(() => { const d = [...document.querySelectorAll('#ptabpanel details.disc[data-disc^=$1]')]; return \`\${d.filter((x) => !x.open).length} \${d.length}\`; })()"; }
opens() { # disc id: clicks its summary, prints open state and the summary text
  js "(() => { const d = document.querySelector('#ptabpanel details[data-disc=$1]'); if (!d) return 'none'; d.querySelector('summary').click(); return \`\${d.open} \${d.querySelector('summary').textContent}\`; })()"
}
yes() { [ "$1" = true ] && echo 1 || echo 0; }
no() { [ "$1" = false ] && echo 1 || echo 0; }

MAP_TABS='Now,Shot,Sky,Find,Weather,Map,Markers'
VF_TABS='Now,Shot,Sky,Find,Weather,View,Markers'
for vp in "desktop 1600 1000" "390 390 844"; do
  read -r name w h <<<"$vp"
  ab set viewport "$w" "$h" >/dev/null
  go "/?$Q"
  r=$(names)
  check "map $name: tab order on one row" "$([ "$r" = "1 $MAP_TABS" ] && echo 1 || echo 0)" "$r"
  go "/viewfinder?$Q"
  r=$(names)
  check "viewfinder $name: tab order on one row" "$([ "$r" = "1 $VF_TABS" ] && echo 1 || echo 0)" "$r"
done

# 390 px: Aim and the first body row of the readout fit the first screen of Now.
go "/?$Q"
tab Now
fit=$(js '(() => { const a = document.querySelector("#ptabpanel [role=radiogroup][aria-label=Aim]"), r = document.querySelector("#ptabpanel .readout-row"); const b = (e) => e ? Math.round(e.getBoundingClientRect().bottom) : 9999; return `${b(a)} ${b(r)} ${innerHeight}`; })()')
check "map 390 Now: Aim and readout on the first screen" "$(echo "$fit" | awk '{ print ($1 <= $3 && $2 <= $3) ? 1 : 0 }')" "bottoms $fit (aim, readout, viewport)"
ab screenshot "$OUT/tabs-map-now-390.png" >/dev/null

ab set viewport 1600 1000 >/dev/null
for page in map viewfinder; do
  [ $page = map ] && go "/?$Q" || go "/viewfinder?$Q"
  tab Now
  first=$([ $page = map ] && echo Now || echo Aim)
  check "$page Now: $first first" "$(yes "$(js "(() => document.querySelector('#ptabpanel .psec-h')?.textContent === '$first' && !!document.querySelector('#ptabpanel [role=radiogroup][aria-label=Aim]'))()")")" "first heading $first"
  ro=$(has '.readout')
  if [ $page = map ]; then check "map Now: live readout" "$(yes "$ro")" "readout $ro"; else check "viewfinder Now: no second readout (BodyStrip only)" "$(no "$ro")" "readout $ro"; fi
  tab Shot
  check "$page Shot: no Aim" "$(no "$(has '[role=radiogroup][aria-label=Aim]')")" "Shot"
  d=$(discs shot-)
  check "$page Shot: secondaries collapsed" "$(read -r a b <<<"$d"; [ "$a" = "$b" ] && [ "$b" -ge 4 ] && echo 1 || echo 0)" "$d closed of total"
  o=$(opens shot-aperture)
  check "$page Shot: Aperture & DOF opens, summary has f-number" "$([[ $o == "true Aperture & DOF · f/"* ]] && echo 1 || echo 0)" "$o"
  check "$page Shot: no Calculators heading" "$(no "$(text '.psec-h' 'Calculators')")" "Calculators"
  check "$page Shot: Save setup" "$(yes "$(js "[...document.querySelectorAll('#ptabpanel button')].some((b) => b.textContent === 'Save setup')")")" "button"
  cone=$(js "/FOV cone|Cone length/.test(document.getElementById('ptabpanel').textContent)")
  if [ $page = map ]; then check "map Shot: FOV cone and Cone length" "$(yes "$cone")" "$cone"; else check "viewfinder Shot: no FOV cone or Cone length" "$(no "$cone")" "$cone"; fi
  tab Sky
  lp=$(has 'details[data-disc=tools-light-point]')
  if [ $page = map ]; then check "map Sky: Light at a point" "$(yes "$lp")" "$lp"; else check "viewfinder Sky: no Light at a point" "$(no "$lp")" "$lp"; fi
  check "$page Sky: no Find inside" "$(no "$(has '.find')")" "Sky"
  tab Find
  d=$(discs find-)
  want='2 2'; [ $page = map ] && want='3 3'
  check "$page Find: filters and export collapsed" "$(read -r a b <<<"$d"; [ "$a" = "$b" ] && [ "$b" = "${want#* }" ] && echo 1 || echo 0)" "$d closed of total"
  check "$page Find: Search open" "$(yes "$(js "[...document.querySelectorAll('#ptabpanel button')].some((b) => b.textContent === 'Search' && !b.closest('details'))")")" "Search"
  o=$(opens find-filters)
  check "$page Find: filters open, summary has the sky" "$([[ $o == "true Filters · "* ]] && echo 1 || echo 0)" "$o"
  ab screenshot "$OUT/tabs-$page-find.png" >/dev/null
  tab Weather
  check "$page Weather: no Calculators heading" "$(no "$(text '.psec-h' 'Calculators')")" "Calculators"
  check "$page Weather: tides and rainbow" "$(yes "$(js "!!document.querySelector('#ptabpanel details[data-disc=tools-tides], #ptabpanel details[data-disc=tools-rainbow]')")")" "groups"
done

# Shared settings: one label and one widget on both pages.
go "/?$Q"
tab Map
check "map Map: Light segmented" "$(yes "$(js "(() => { const s = document.querySelector('#ptabpanel [role=radiogroup][aria-label=\"Light source for shadows\"]'); return !!s && [...s.querySelectorAll('[role=radio]')].map((b) => b.textContent).join() === 'Auto,Sun,Moon' && !document.querySelector('#ptabpanel select[aria-label=\"Light source for shadows\"]'); })()")")" "Auto,Sun,Moon"
go "/viewfinder?$Q"
tab View
check "viewfinder View: Light segmented" "$(yes "$(js "!!document.querySelector('#ptabpanel [role=radiogroup][aria-label=\"Light source for shadows\"]')")")" "seg"
check "viewfinder View: Horizon range label" "$(yes "$(text '.vrow-k' 'Horizon range')")" "label"
check "viewfinder View: no Aim" "$(no "$(has '[role=radiogroup][aria-label=Aim]')")" "View"
gc=$(js "(() => { const b = document.querySelector('#ptabpanel button[data-setting=showGc]'); if (!b || b.textContent !== 'Galactic Centre') return 'none'; const s = window.__scape.settings, v = s.getState().showGc; b.click(); const w = s.getState().showGc; s.getState().update({ showGc: v }); return \`\${v !== w}\`; })()")
check "viewfinder View: Galactic Centre toggles s.showGc" "$(yes "$gc")" "$gc"

# Out of forecast range: one "no forecast", not one per card.
js "(() => { window.__scape.settings.getState().update({ weather: true }); return 'ok'; })()" >/dev/null
go "/?camera=46.5476,7.9806&target=46.5775,8.0053&t=2031-07-15T12:00Z"
tab Weather
wait_for "document.querySelector('#ptabpanel [data-wx=none]')" 60
n=$(js "[...document.querySelectorAll('#ptabpanel .wx-missing')].length + ' ' + /no forecast for this hour/i.test(document.querySelector('#ptabpanel .cloud-row')?.textContent ?? '')")
check "Weather: one no-forecast message" "$([ "$n" = '1 false' ] && echo 1 || echo 0)" "$n (messages, cloud row repeats)"
ab screenshot "$OUT/tabs-weather-none.png" >/dev/null

# Legacy tab names from an earlier build migrate.
js "(() => { const raw = JSON.parse(localStorage.getItem('scape.ui') ?? '{\"state\":{},\"version\":2}'); raw.state.panelTabs = { map: 'Plan', viewfinder: 'Frame' }; localStorage.setItem('scape.ui', JSON.stringify(raw)); return 'ok'; })()" >/dev/null
go "/?$Q"
m=$(js 'document.querySelector("[role=tab][aria-selected=true]")?.textContent')
go "/viewfinder?$Q"
v=$(js 'document.querySelector("[role=tab][aria-selected=true]")?.textContent')
check "panelTabs Plan/Frame migrate to Now/Shot" "$([ "$m|$v" = 'Now|Shot' ] && echo 1 || echo 0)" "map $m, viewfinder $v"

[ "$BRAVE" = 1 ] && brave_stop "$PROFILE" && rm -rf "$PROFILE"

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
