#!/usr/bin/env bash
# Panel smoke: six tabs on one row, keyboard switching, every former panel reachable, Today's now line and dials, neutral look, phone width.
# Usage: scripts/smoke/panel.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port; launches a headless Brave on the CDP port unless one answers, and stops only what it started.
set -uo pipefail

PORT=${1:-5465}
CDP=${2:-9465}
OUT=${3:-${TMPDIR:-/tmp}/panel}
BASE="http://localhost:$PORT"
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
. "$ROOT/scripts/smoke/brave.sh"
mkdir -p "$OUT"
PROFILE="$OUT/brave-profile"
CAMERA=45.9763,7.6586
DAY=2026-06-21T10:00Z

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
tab() { js "(() => { const u = window.__scape.ui.getState(); u.setPanelTab('$1'); u.setPanelCollapsed(false); return 'ok'; })()" >/dev/null; sleep 0.3; }
active() { js 'document.querySelector("[role=tab][aria-selected=true]")?.textContent + " " + document.activeElement?.id'; }
reach() { # tab, name, selector
  tab "$1"
  local ok; ok=$(wait_for "document.querySelector('#ptabpanel $3')" 20 && echo 1 || echo 0)
  check "$1 reaches $2" "$ok" "$3"
}
go() {
  ab open "$BASE/?camera=$CAMERA&t=$DAY" >/dev/null
  wait_for 'window.__scape && document.querySelector("[role=tablist]")' 80
  tab Plan
}
row() { # tag
  local r; r=$(js '(() => { const t = [...document.querySelectorAll(".tablist [role=tab]")]; return `${t.length} ${new Set(t.map((b) => b.offsetTop)).size} ${t.map((b) => b.textContent).join(",")}`; })()')
  check "$1 six tabs on one row" "$([[ $r == '6 1 Plan,Frame,Sky,Weather,Map,Markers' ]] && echo 1 || echo 0)" "$r"
}
wide() { # tag
  local w; w=$(js 'document.documentElement.scrollWidth > window.innerWidth || document.querySelector("#ptabpanel").scrollWidth > document.querySelector("#ptabpanel").clientWidth')
  check "$1 no sideways scroll" "$([ "$w" = false ] && echo 1 || echo 0)" "overflow $w"
}

ab set viewport 1600 1000 >/dev/null
go
row desktop

# Keyboard: arrows wrap, Home and End jump, focus follows.
js 'document.getElementById("ptab-Plan").focus(); "ok"' >/dev/null
ab press ArrowRight >/dev/null; k1=$(active)
ab press End >/dev/null; k2=$(active)
ab press ArrowRight >/dev/null; k3=$(active)
ab press ArrowLeft >/dev/null; k4=$(active)
ab press Home >/dev/null; k5=$(active)
check "keyboard → End → (wrap) ← Home" "$([[ "$k1|$k2|$k3|$k4|$k5" == 'Frame ptab-Frame|Markers ptab-Markers|Plan ptab-Plan|Markers ptab-Markers|Plan ptab-Plan' ]] && echo 1 || echo 0)" "$k1 / $k2 / $k3 / $k4 / $k5"
aria=$(js '(() => { const t = document.getElementById("ptab-Plan"), p = document.getElementById("ptabpanel"); return `${t.getAttribute("aria-controls")} ${p.getAttribute("role")} ${p.getAttribute("aria-labelledby")} ${[...document.querySelectorAll("[role=tab]")].map((b) => b.tabIndex).join("")}`; })()')
check "tablist ARIA and roving tabindex" "$([ "$aria" = 'ptabpanel tabpanel ptab-Plan 0-1-1-1-1-1' ] && echo 1 || echo 0)" "$aria"

# Every former panel's key control.
reach Plan Timeline '.timeline li[data-time]'
reach Plan Geodetics '.geo'
reach Frame Frame '.frame select, .frame input'
reach Frame 'Tools exposure' 'input[aria-label="Aperture, f-number"]'
reach Sky Night '.moon-chart, .night'
reach Sky Find '.find .seg button'
reach Sky 'Tools moon' '.tools details'
reach Weather Weather '.weather'
reach Weather 'tide and cloud rows' '.cloud-row'
reach Weather 'Tools clouds' 'input[aria-label="Cloud base above the ground"]'
reach Map Layers '.layers input[type=checkbox]'
reach Map Offline 'input[aria-label="Name for the region"]'
reach Markers Markers '.markers .actions button'
reach Markers Models '.markers-switch button'

# Today: the now line sits between the events around now, and every event has a dial.
tab Plan
wait_for 'document.querySelector(".timeline li.now-line")' 40
nl=$(js '(() => { const n = document.querySelector(".timeline li.now-line"); const t = window.__scape.world.getState().time; const p = n.previousElementSibling?.dataset.time, q = n.nextElementSibling?.dataset.time; return `${(p === undefined || +p <= t) && (q === undefined || +q > t)} ${p ?? "-"} ${t} ${q ?? "-"} ${n.textContent}`; })()')
check "now line between the events around now" "$([[ $nl == true* ]] && echo 1 || echo 0)" "$nl"
dials=$(js '`${document.querySelectorAll(".timeline li[data-time]").length} ${document.querySelectorAll(".timeline li[data-time] svg.brg").length}`')
check "one dial per event" "$(awk -v a="${dials% *}" -v b="${dials#* }" 'BEGIN { print (a > 0 && a == b) ? 1 : 0 }')" "$dials events, dials"

# Row grammar on the other tabs, on the timeline's grid; a tidal camera for the tide rows (tides and sightlines need live data).
AREAS=$(js 'getComputedStyle(document.querySelector(".timeline li[data-time] button")).gridTemplateAreas')
grammar() { # tab, name, row selector, min rows
  tab "$1"
  wait_for "document.querySelectorAll('#ptabpanel $3').length >= $4" 60
  local r; r=$(js "(() => { const rs = [...document.querySelectorAll('#ptabpanel $3')]; const ok = rs.filter((e) => { const s = getComputedStyle(e); return s.display === 'grid' && s.gridTemplateAreas === \`$AREAS\` && e.querySelector('.label') && e.querySelector('svg.brg, .dot'); }); return \`\${rs.length} \${ok.length}\`; })()")
  check "$1 $2 use the row grammar" "$(awk -v a="${r% *}" -v b="${r#* }" -v m="$4" 'BEGIN { print (a >= m && a == b) ? 1 : 0 }')" "$r rows, on grid"
}
ab open "$BASE/?camera=40.7359,-74.0286&t=2026-08-12T23:00Z" >/dev/null
wait_for 'window.__scape && document.querySelector("[role=tablist]")' 80
grammar Sky 'moon and core rows' '.night .brow' 3
grammar Weather 'rainbow readouts' '.tools .readout-row' 1
grammar Weather 'tide extremes' '.tide-extremes .brow' 2
grammar Weather 'sightlines' '.wx-sight summary.brow' 1
sec=$(js '(() => { const p = document.createElement("i"); p.style.color = "var(--bg-3)"; document.body.append(p); const want = getComputedStyle(p).color; p.remove(); const b = [...document.querySelectorAll("#ptabpanel .psec-b")]; return `${b.length} ${b.filter((e) => getComputedStyle(e).backgroundColor === want).length}`; })()')
check "section bodies sit on bg-3" "$(awk -v a="${sec% *}" -v b="${sec#* }" 'BEGIN { print (a > 0 && a == b) ? 1 : 0 }')" "$sec"
go
font=$(js 'getComputedStyle(document.querySelector(".panel")).fontFamily')
check "panel font is Helvetica" "$([[ $font == *Helvetica* ]] && echo 1 || echo 0)" "$font"

# No old blue accent on panel chrome; the sky inks and dials keep their colours.
blue=0
for t in Plan Frame Sky Weather Map Markers; do
  tab "$t"
  n=$(js '(() => { const blue = /rgba?\(90, 169, 255/; return [...document.querySelectorAll(".panel *")].filter((e) => !e.closest("svg") && !/\b(moon|sun|mw|gc|ink|swatch|cat)\b/.test(e.className)).filter((e) => { const s = getComputedStyle(e); return [s.color, s.backgroundColor, s.borderTopColor, s.borderBottomColor, s.outlineColor, s.accentColor].some((c) => blue.test(c)); }).map((e) => e.tagName + "." + e.className).slice(0, 3).join(" ") || "none"; })()')
  [ "$n" = none ] || blue="$blue; $t: $n"
done
check "no blue accent on panel chrome" "$([ "$blue" = 0 ] && echo 1 || echo 0)" "$blue"
# Selections: underline bar for one-of, 9 px square box for toggles; no rings, no radius.
tab Frame
sel=$(js '(() => { const one = [...document.querySelectorAll("#ptabpanel :is(.seg, .chips.one) button.on")]; const box = [...document.querySelectorAll("#ptabpanel input[type=checkbox]")]; const u = one.filter((b) => { const s = getComputedStyle(b); return /inset$|0px -2px 0px 0px/.test(s.boxShadow) && s.boxShadow.includes("-2px") && s.borderTopLeftRadius === "0px" && s.outlineStyle === "none" && s.fontWeight === "700"; }).length; const q = box.filter((b) => { const s = getComputedStyle(b); return s.appearance === "none" && s.width === "9px" && s.height === "9px" && s.borderTopLeftRadius === "0px"; }).length; return `${one.length} ${u} ${box.length} ${q}`; })()')
check "selections are underline bars and square boxes" "$(echo "$sel" | awk '{ print ($1 > 0 && $1 == $2 && $3 > 0 && $3 == $4) ? 1 : 0 }')" "$sel (one-of, underlined, boxes, square)"
wide desktop
tab Plan
ab screenshot "$OUT/panel-1600.png" >/dev/null

# Viewfinder: View replaces Map, its toggles drive their flags, and each page keeps its own tab.
VF="$BASE/viewfinder?camera=51.9225,4.4792&target=51.9055,4.4886&t=2026-06-21T19:00Z"
vfgo() {
  ab open "$VF" >/dev/null
  wait_for 'window.__scape && document.querySelector("[role=tablist]")' 80
}
vfrow() { # tag
  local r; r=$(js '(() => { const t = [...document.querySelectorAll(".tablist [role=tab]")]; return `${t.length} ${new Set(t.map((b) => b.offsetTop)).size} ${t.map((b) => b.textContent).join(",")}`; })()')
  check "$1 viewfinder six tabs on one row, View for Map" "$([[ $r == '6 1 Plan,Frame,Sky,Weather,View,Markers' ]] && echo 1 || echo 0)" "$r"
}
# An earlier run's viewfinder tab persists; no name falls back to the page default.
js "(() => { window.__scape.ui.getState().setPanelTab('', 'viewfinder'); return 'ok'; })()" >/dev/null
tab Frame
vfgo
vfrow desktop
t=$(js '`${document.querySelector("[role=tab][aria-selected=true]")?.textContent} ${document.querySelectorAll(".vf-tools").length}`')
check "viewfinder opens on View, no old tool strip" "$([ "$t" = 'View 0' ] && echo 1 || echo 0)" "$t"
# Started here and polled: one long eval outlasts the agent-browser read timeout under load. Timeouts, not rAF: the tab may be hidden.
js '(() => { window.__flags = null; (async () => { const c = window.__scape.composition, frame = () => new Promise((r) => setTimeout(r, 50)); const bs = [...document.querySelectorAll("#ptabpanel button[data-flag]:not(:disabled)")]; const bad = []; for (const b of bs) { const k = b.dataset.flag, v = c.getState()[k]; b.click(); await frame(); const ok = c.getState()[k] === !v && b.getAttribute("aria-pressed") === String(!v); b.click(); await frame(); if (!(ok && c.getState()[k] === v)) bad.push(k); } window.__flags = `${bs.length} ${bad.join(",") || "ok"}`; })(); return "ok"; })()' >/dev/null
flags=$(wait_for 'window.__flags' 120 >/dev/null; js 'window.__flags')
check "every View toggle flips its own flag" "$([[ $flags =~ ^1[0-9]\ ok$ ]] && echo 1 || echo 0)" "$flags"
tab Sky
ab open "$BASE/?camera=$CAMERA&t=$DAY" >/dev/null
wait_for 'window.__scape && document.querySelector("[role=tablist]")' 80
mp=$(js 'document.querySelector("[role=tab][aria-selected=true]")?.textContent')
tab Map
vfgo
vp=$(js 'document.querySelector("[role=tab][aria-selected=true]")?.textContent')
check "each page keeps its own tab" "$([ "$mp|$vp" = 'Frame|Sky' ] && echo 1 || echo 0)" "map $mp, viewfinder $vp"
tab Markers
wait_for 'document.querySelector("#ptabpanel .markers")' 20
mo=$(js '[...document.querySelectorAll("#ptabpanel button")].filter((b) => /map centre|clicking the map|Show on map/.test(b.textContent)).length')
check "map-only controls absent on the viewfinder" "$([ "$mo" = 0 ] && echo 1 || echo 0)" "$mo found"
tab View
ab screenshot "$OUT/panel-vf-1600.png" >/dev/null

ab set viewport 390 844 >/dev/null
go
row phone
t44=$(js '[...document.querySelectorAll(".tablist [role=tab], .tabs-collapse")].map((b) => { const r = b.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); }).join(",")')
check "phone tabs and collapse handle are 44 px" "$(echo "$t44" | tr , '\n' | awk '$1 < 44 { bad = 1 } END { print bad ? 0 : 1 }')" "$t44"
for t in Plan Frame Sky Weather Map Markers; do
  tab "$t"
  wide "phone $t"
done
js '(() => { document.querySelector(".tabs-collapse").click(); return "ok"; })()' >/dev/null
sleep 0.3
c=$(js '`${window.__scape.ui.getState().panelCollapsed} ${!!document.querySelector(".tablist")?.offsetParent} ${!!document.querySelector("#ptabpanel")?.offsetParent}`')
check "phone collapse keeps the tab row as the peek bar" "$([ "$c" = 'true true false' ] && echo 1 || echo 0)" "collapsed, tabs shown, body shown: $c"
js '(() => { document.querySelector(".tabs-collapse").click(); return "ok"; })()' >/dev/null
sleep 0.3
c=$(js '`${window.__scape.ui.getState().panelCollapsed} ${!!document.querySelector("#ptabpanel")?.offsetParent}`')
check "phone expand shows the body again" "$([ "$c" = 'false true' ] && echo 1 || echo 0)" "$c"
tab Plan
ab screenshot "$OUT/panel-390.png" >/dev/null
vfgo
vfrow phone
for t in View Sky; do
  tab "$t"
  wide "phone viewfinder $t"
done
ab screenshot "$OUT/panel-vf-390.png" >/dev/null
ab set viewport 1400 900 >/dev/null

[ "$BRAVE" = 1 ] && brave_stop "$PROFILE" && rm -rf "$PROFILE"

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
