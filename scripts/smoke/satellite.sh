#!/usr/bin/env bash
# Satellite smoke: the Layers toggle, the source picked per scene, border fill, credits, idle fetches, and a 390x844 phone.
# Usage: scripts/smoke/satellite.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port and a headless Brave with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5840}
CDP=${2:-9840}
OUT=${3:-${TMPDIR:-/tmp}/satellite}
BASE="http://localhost:$PORT"
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

MAP='window.__scapeMap'
ab set viewport 1400 900 >/dev/null
ab open "$BASE/?camera=51.9225,4.4792&z=15" >/dev/null 2>&1
wait_for "window.__scape && $MAP && $MAP.isStyleLoaded()" 120 || { echo "app did not load"; exit 1; }

# Off by default: no source, no fetches.
off=$(js "String(!$MAP.getSource('satellite') && !window.__scape.settings.getState().showSatellite && !(window.__scape.satellite && window.__scape.satellite.fetches))")
check "off by default, nothing fetched" "$([ "$off" = true ] && echo 1 || echo 0)" "$off"

js "window.__scape.ui.getState().setPanelTab('Map')" >/dev/null
wait_for "document.querySelector('.layer-row[data-layer=showSatellite] input')" 40
js "document.querySelector('.layer-row[data-layer=showSatellite] input').click()" >/dev/null
wait_for "$MAP.getLayer('satellite')" 40
check "Layers toggle adds the satellite layer" "$([ "$(js "String(!!$MAP.getLayer('satellite'))")" = true ] && echo 1 || echo 0)" "$(js "document.querySelector('.layer-row[data-layer=showSatellite]').innerText.replace(/\\n/g, ' ')")"

# Moves the map and prints "sources in view|tiles with no source|credits" once tiles settle.
scene() { # lng, lat, zoom
  js "(() => { window.__scape.satellite && (window.__scape.satellite.tiles = {}, window.__scape.satellite.stats = {}); $MAP.jumpTo({ center: [$1, $2], zoom: $3 }); })()" >/dev/null
  sleep 0.5
  wait_for "$MAP.areTilesLoaded() && window.__scape.satellite && Object.keys(window.__scape.satellite.tiles).length" 160
  sleep 1
  js "(() => { const t = Object.values(window.__scape.satellite.tiles); const ids = [...new Set(t.flat())].sort(); const a = document.querySelector('.maplibregl-ctrl-attrib-inner'); return ids.join(',') + '|' + t.filter((l) => !l.length).length + '/' + t.length + '|' + (a ? a.innerText : ''); })()"
}
has() { case ",$1," in *",$2,"*) echo 1 ;; *) echo 0 ;; esac; }

r=$(scene 4.4792 51.9225 16)
ab screenshot "$OUT/rotterdam.png" >/dev/null
check "Rotterdam: PDOK, credited" "$([ "$(has "${r%%|*}" nl-pdok)" = 1 ] && [[ "$r" == *PDOK* ]] && echo 1 || echo 0)" "$r"


r=$(scene 11.26 47.84 16)
ab screenshot "$OUT/bavaria-rural.png" >/dev/null
check "rural Bavaria: Bayern DOP, credited" "$([ "$(has "${r%%|*}" de-bayern)" = 1 ] && [[ "$r" == *Bayerische* ]] && echo 1 || echo 0)" "$r"

r=$(scene 6.215 51.37 15)
ab screenshot "$OUT/venlo-border.png" >/dev/null
ids=${r%%|*}
rest=${r#*|}
check "NL/DE border at Venlo: both sides, no empty tile" "$([ "$(has "$ids" nl-pdok)" = 1 ] && [ "$(has "$ids" de-nrw)" = 1 ] && [ "${rest%%/*}" = 0 ] && echo 1 || echo 0)" "$r"

border() { # name, screenshot, want-id, lng, lat, zoom
  local r ids rest
  r=$(scene "$4" "$5" "$6")
  ab screenshot "$OUT/$2" >/dev/null
  ids=${r%%|*}
  rest=${r#*|}
  check "$1" "$([ "$(has "$ids" "$3")" = 1 ] && [ "${rest%%/*}" = 0 ] && echo 1 || echo 0)" "$r"
}
border "NL/BE at Baarle-Nassau: PDOK, no empty tile" baarle-nl-be.png nl-pdok 4.93 51.445 16
border "PL/DE on the Oder at Frankfurt: no empty tile" oder-pl-de.png de-brandenburg 14.55 52.34 15

# Thickest white square and mean sharpness over the tiles in view, from the dev stats.
stats() { js "(() => { const s = Object.values(window.__scape.satellite.stats || {}); const d = s.length ? s.reduce((a, v) => a + v.detail, 0) / s.length : 0; return Math.max(0, ...s.map((v) => v.white)) + '|' + d.toFixed(1); })()"; }
WHITE_MAX=6
# A JPEG-only source's white no-data fill must give way to what lies beyond it.
fill() { # name, screenshot, want-ids (comma), lng, lat, zoom
  local r st ok=1 id
  r=$(scene "$4" "$5" "$6")
  ab screenshot "$OUT/$2" >/dev/null
  st=$(stats)
  for id in ${3//,/ }; do [ "$(has "${r%%|*}" "$id")" = 1 ] || ok=0; done
  [ "${st%%|*}" -le "$WHITE_MAX" ] || ok=0
  check "$1" "$ok" "white ${st%%|*} px; ${r%%|*}"
}
fill "AT/CH on the Rhine at Feldkirch: both sides, no fill strip" feldkirch-at-ch.png at-basemap,ch-swissimage 9.51 47.25 15
fill "NL/BE in Zeeland: no PDOK fill strip" fill-nl-be-zeeland.png nl-pdok 3.56 51.262 14
fill "NL/BE at Hulst–Antwerp: no PDOK fill strip" fill-nl-be-antwerp.png nl-pdok 4.438 51.40 14
fill "NL/Lower Saxony at Emlichheim: no PDOK fill strip" fill-nl-nds.png nl-pdok 7.075 52.723 14
fill "LU/BE at Troisvierges: no geoportail.lu fill strip" fill-lu-be.png lu 5.845 50.036 14
fill "LU/FR at Esch: no geoportail.lu fill, IGN beyond" fill-lu-fr.png lu,fr-ign 6.108 49.468 14
fill "AT/SK/HU at Bratislava: no basemap.at fill strip" fill-at-east.png at-basemap 17.139 47.931 14
fill "AT/SI at the Karawanks: no basemap.at fill strip" fill-at-south.png at-basemap 14.53 46.41 14

# SWISSIMAGE is blocky outside Switzerland: Feldkirch must come sharp from basemap.at.
r=$(scene 9.598 47.237 17)
ab screenshot "$OUT/feldkirch-sharp.png" >/dev/null
st=$(stats)
check "Feldkirch z17: basemap.at, sharp (detail ≥ 9)" "$([ "$(has "${r%%|*}" at-basemap)" = 1 ] && awk "BEGIN { exit !(${st#*|} >= 9) }" && echo 1 || echo 0)" "detail ${st#*|}; ${r%%|*}"

# US state and city orthos, and NAIP Plus off them, are sharp at z18 where stretched USGS gave detail 0.4–1.6.
sharp() { # name, screenshot, want-id, credit, min-detail, lng, lat, zoom
  local r st
  r=$(scene "$6" "$7" "$8")
  ab screenshot "$OUT/$2" >/dev/null
  st=$(stats)
  check "$1" "$([ "$(has "${r%%|*}" "$3")" = 1 ] && [[ "$r" == *"$4"* ]] && awk "BEGIN { exit !(${st#*|} >= $5) }" && echo 1 || echo 0)" "detail ${st#*|}; $r"
}
sharp "Hartford z18: CT ECO, sharp" us-hartford.png us-ct "CT ECO" 3 -72.6851 41.7637 18
sharp "Manhattan z18: NYC orthos, sharp" us-manhattan.png us-nyc "NYC OTI" 3 -73.9855 40.758 18
sharp "Boston z18: MassGIS, sharp" us-boston.png us-ma MassGIS 3 -71.0589 42.3601 18
sharp "Louisville z18: KyFromAbove, credited" us-louisville.png us-ky3 KyFromAbove 3 -85.7585 38.2527 18
sharp "rural Kansas z18: NAIP Plus, sharper than USGS" us-kansas.png us-naipplus "USGS, USDA" 1.2 -98.0 38.5 18
sharp "Atlanta z18: Fulton exportImage" us-atlanta.png us-fulton "Fulton County" 3 -84.388 33.749 18
# VT answers 200 JSON outside its data and exportImage IN transparent PNG: neither may leave a hole.
border "Lake Champlain, where VT sends 200 JSON: USGS, no empty tile" us-vt-lake.png us-naip -73.33 44.48 14
border "IN/KY on the Ohio at Louisville: no empty tile" us-in-ky.png us-in -85.75 38.275 16

# Snow and white roofs are imagery: every tile comes whole from the national source.
only() { js "String(Object.values(window.__scape.satellite.tiles).every((l) => l.join() === '$1'))"; }
r=$(scene 7.985 46.547 16)
ab screenshot "$OUT/jungfraujoch-snow.png" >/dev/null
check "Jungfraujoch snow: SWISSIMAGE in every tile" "$([ "$(only ch-swissimage)" = true ] && echo 1 || echo 0)" "$r"

r=$(scene 4.25 52.0 17)
ab screenshot "$OUT/westland-roofs.png" >/dev/null
check "Westland greenhouse roofs: PDOK in every tile" "$([ "$(only nl-pdok)" = true ] && echo 1 || echo 0)" "$r"

r=$(scene -0.1276 51.5072 15)
ab screenshot "$OUT/london.png" >/dev/null
hint=$(js "document.querySelector('.layer-row[data-layer=showSatellite] .hint').innerText")
if [[ "$hint" == *"needs a MapTiler key"* ]]; then
  check "London without a MapTiler key: no imagery, hint says so" "$([ "${r%%|*}" = "" ] && echo 1 || echo 0)" "$r; $hint"
else
  check "London with a MapTiler key: MapTiler and its logo" "$([ "$(has "${r%%|*}" maptiler)" = 1 ] && [ "$(js "String(!!document.querySelector('[data-sat-logo=maptiler]'))")" = true ] && echo 1 || echo 0)" "$r"
fi

# Idle: once settled, no more fetches.
scene 4.4792 51.9225 16 >/dev/null
f0=$(js "window.__scape.satellite.fetches")
sleep 4
f1=$(js "window.__scape.satellite.fetches")
check "idle: no fetches over 4 s" "$([ "$f0" = "$f1" ] && echo 1 || echo 0)" "$f0 -> $f1"

ab set viewport 390 844 >/dev/null
r=$(scene 4.4692 51.9225 16)
ab screenshot "$OUT/phone-rotterdam.png" >/dev/null
wide=$(js 'String(document.documentElement.scrollWidth > window.innerWidth)')
check "phone 390×844 Rotterdam: imagery, no sideways scroll" "$([ "$(has "${r%%|*}" nl-pdok)" = 1 ] && [ "$wide" = false ] && echo 1 || echo 0)" "overflow $wide; ${r%%|*}"

js "document.querySelector('.layer-row[data-layer=showSatellite] input') ? document.querySelector('.layer-row[data-layer=showSatellite] input').click() : window.__scape.settings.getState().update({ showSatellite: false })" >/dev/null
wait_for "!$MAP.getSource('satellite')" 40
check "toggle off removes the layer and its credit" "$([ "$(js "String(!$MAP.getSource('satellite') && !$MAP.getSource('satellite-credit'))")" = true ] && echo 1 || echo 0)" ""

ab set viewport 1400 900 >/dev/null 2>&1
echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
