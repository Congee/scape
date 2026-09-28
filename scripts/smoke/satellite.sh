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

js "window.__scape.ui.getState().setPanelTab('Layers')" >/dev/null
wait_for "document.querySelector('.layer-row[data-layer=showSatellite] input')" 40
js "document.querySelector('.layer-row[data-layer=showSatellite] input').click()" >/dev/null
wait_for "$MAP.getLayer('satellite')" 40
check "Layers toggle adds the satellite layer" "$([ "$(js "String(!!$MAP.getLayer('satellite'))")" = true ] && echo 1 || echo 0)" "$(js "document.querySelector('.layer-row[data-layer=showSatellite]').innerText.replace(/\\n/g, ' ')")"

# Moves the map and prints "sources in view|tiles with no source|credits" once tiles settle.
scene() { # lng, lat, zoom
  js "(() => { window.__scape.satellite && (window.__scape.satellite.tiles = {}); $MAP.jumpTo({ center: [$1, $2], zoom: $3 }); })()" >/dev/null
  sleep 0.5
  wait_for "$MAP.areTilesLoaded() && window.__scape.satellite && Object.keys(window.__scape.satellite.tiles).length" 160
  sleep 1
  js "(() => { const t = Object.values(window.__scape.satellite.tiles); const ids = [...new Set(t.flat())].sort(); const a = document.querySelector('.maplibregl-ctrl-attrib-inner'); return ids.join(',') + '|' + t.filter((l) => !l.length).length + '/' + t.length + '|' + (a ? a.innerText : ''); })()"
}
has() { case ",$1," in *",$2,"*) echo 1 ;; *) echo 0 ;; esac; }

r=$(scene 4.4792 51.9225 16)
ab screenshot "$OUT/rotterdam.png" >/dev/null
check "Rotterdam: PDOK, credited" "$([ "$(has "${r%%|*}" nl-pdok)" = 1 ] && [[ "$r" == *PDOK* ]] && echo 1 || echo 0)" "$r"

r=$(scene -73.9855 40.758 16)
ab screenshot "$OUT/manhattan.png" >/dev/null
check "Manhattan: NAIP, credited" "$([ "$(has "${r%%|*}" us-naip)" = 1 ] && [[ "$r" == *"National Map"* ]] && echo 1 || echo 0)" "$r"

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
border "AT/CH on the Rhine at Feldkirch: SWISSIMAGE, no empty tile" feldkirch-at-ch.png ch-swissimage 9.56 47.25 15
border "PL/DE on the Oder at Frankfurt: no empty tile" oder-pl-de.png de-brandenburg 14.55 52.34 15

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
