#!/usr/bin/env bash
# Offline smoke: the Map tab holds one row into Settings' Offline section, with the region count; Settings holds every Offline part,
# takes the last map view, and drawing a region opens the map and comes back. Desktop and 390 px, no sideways scroll.
# Usage: scripts/smoke/offline.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port; launches a headless Brave on the CDP port unless one answers, and stops only what it started.
set -uo pipefail

PORT=${1:-5474}
CDP=${2:-9474}
OUT=${3:-${TMPDIR:-/tmp}/offline}
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

HEADS='Offline storage,Region,Download,Saved regions,Import,Night lights (VIIRS),Nightly lights (GIBS),Geoid (Japan)'
ROW='document.querySelector(".tab-body a.offline-row")'
FITS='document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll(".page, .tab-body")].every((e) => e.scrollWidth <= e.clientWidth)'
# Two kinds of one download share a box; an import has its own.
FAKE='(() => { const o = window.__scape.offline; window.__realArchives = o.getState().archives; const b = { west: 1, south: 1, east: 2, north: 2 }; o.setState({ archives: [{ id: "t1", kind: "terrain", bbox: b }, { id: "t2", kind: "buildings", bbox: { ...b, digits: { lat: 4, lng: 4 } } }, { id: "t3", kind: "basemap", bbox: { west: 3, south: 3, east: 4, north: 4 } }] }); return 1; })()'
REAL='(() => { window.__scape.offline.setState({ archives: window.__realArchives }); return 1; })()'

map_tab() {
  ab open "$BASE/" >/dev/null
  wait_for '!!window.__scapeMap && !!document.querySelector(".panel-inner .tablist") && window.__scape.offline.getState().loaded' 80
  js '(() => { window.__scape.ui.setState({ panelCollapsed: false }); document.getElementById("ptab-Map").click(); return 1; })()' >/dev/null
  wait_for "!!$ROW" 40
}

for vp in "desktop 1600 1000" "390 390 844"; do
  read -r name w h <<<"$vp"
  ab set viewport "$w" "$h" >/dev/null
  map_tab

  # Map tab: one row, the count, nothing else of Offline.
  r=$(js "(() => { const r = $ROW; const n = new Set(window.__scape.offline.getState().archives.map((a) => [a.bbox.west, a.bbox.south, a.bbox.east, a.bbox.north].join())).size; const b = document.querySelector('.tab-body'); const left = b.querySelectorAll('[data-viirs], [data-gibs], [data-geoid], input[aria-label=\"Name for the region\"]').length; return [r.textContent.trim() === \`Offline maps · \${n} \${n === 1 ? 'region' : 'regions'}\`, r.getAttribute('href'), b.querySelectorAll('a.offline-row').length, left, r.getBoundingClientRect().height >= 24, r.textContent.trim()].join(' '); })()")
  check "$name Map tab: one row with the region count, no Offline parts" "$([[ $r == "true /settings#offline 1 0 true "* ]] && echo 1 || echo 0)" "$r"
  js "$FAKE" >/dev/null
  wait_for "$ROW.textContent.trim() === 'Offline maps · 2 regions'" 20
  t=$(js "$ROW.textContent.trim()")
  js "$REAL" >/dev/null
  check "$name Map tab: count is regions, not archives" "$([ "$t" = 'Offline maps · 2 regions' ] && echo 1 || echo 0)" "3 archives in 2 boxes: $t"
  l=$(js '[...document.querySelectorAll(".tab-body label")].some((l) => l.textContent.trim() === "Light pollution")')
  check "$name Map tab: Light pollution label" "$([ "$l" = true ] && echo 1 || echo 0)" "$l"
  check "$name Map tab: no sideways scroll" "$([ "$(js "$FITS")" = true ] && echo 1 || echo 0)" "scrollWidth $(js 'document.documentElement.scrollWidth') / $w"
  ab screenshot "$OUT/offline-maptab-$name.png" >/dev/null

  # The row opens Settings at the section.
  js "(() => { $ROW.click(); return 1; })()" >/dev/null
  wait_for 'location.pathname === "/settings" && !!document.getElementById("offline")' 40
  sleep 0.5
  at=$(js '[location.pathname + location.hash, Math.round(document.getElementById("offline").getBoundingClientRect().top)].join(" ")')
  check "$name row opens Settings at Offline" "$([[ $at == "/settings#offline "* ]] && [ "${at##* }" -ge -2 ] && [ "${at##* }" -le 40 ] && echo 1 || echo 0)" "$at"

  heads=$(js '[...document.querySelectorAll("#offline .psec-h")].map((h) => h.textContent.trim()).filter((t) => t !== "Downloads").join(",")')
  check "$name Settings: Offline parts in order" "$([ "$heads" = "$HEADS" ] && echo 1 || echo 0)" "$heads"
  c=$(js '(() => { const s = document.getElementById("offline"); return ["input[aria-label=\"Name for the region\"]", "select[aria-label=\"Highest basemap zoom\"]", "input[type=file]", "[data-viirs]", "[data-gibs]", "[data-geoid]"].filter((q) => !s.querySelector(q)).join(",") || "all"; })()')
  check "$name Settings: storage, region, download, import, VIIRS, GIBS, geoid controls" "$([ "$c" = all ] && echo 1 || echo 0)" "missing: $c"

  # The view the map last showed.
  v=$(js '(() => { const b = [...document.querySelectorAll("#offline button")].find((b) => b.textContent.trim() === "Use the map view"); if (!b || b.disabled) return "disabled"; window.__scape.offline.getState().setDraft(null); b.click(); const s = window.__scape.offline.getState(); return JSON.stringify(s.draft) === JSON.stringify(s.mapView) && !!s.draft ? "taken" : "differs"; })()')
  sleep 0.3
  k=$(js '[...document.querySelectorAll("#offline .k")].map((k) => k.textContent).join(",")')
  check "$name Settings: Use the map view takes the last map bounds" "$([ "$v" = taken ] && [[ $k == Corners,Size* ]] && echo 1 || echo 0)" "$v; $k"
  check "$name Settings: no sideways scroll" "$([ "$(js "$FITS")" = true ] && echo 1 || echo 0)" "scrollWidth $(js 'document.documentElement.scrollWidth') / $w"
  ab screenshot "$OUT/offline-settings-$name.png" >/dev/null
done

# Drawing opens the map with the hint; Esc comes back without a region change.
ab set viewport 1600 1000 >/dev/null
before=$(js 'JSON.stringify(window.__scape.offline.getState().draft)')
js '(() => { [...document.querySelectorAll("#offline button")].find((b) => b.textContent.trim() === "Draw on the map").click(); return 1; })()' >/dev/null
wait_for 'location.pathname === "/" && !!window.__scapeMap && !!document.querySelector(".map-notice[data-kind=Drawing]")' 80
n=$(js '[location.pathname, document.querySelector(".map-notice[data-kind=Drawing]")?.textContent ?? "none", window.__scapeMap.getCanvas().style.cursor].join(" | ")')
check "Draw on the map: map opens with the hint, crosshair" "$([ "$n" = '/ | Drag a rectangle on the map; Esc cancels. | crosshair' ] && echo 1 || echo 0)" "$n"
ab screenshot "$OUT/offline-drawing.png" >/dev/null
ab press Escape >/dev/null
wait_for 'location.pathname === "/settings" && !!document.getElementById("offline")' 40
e=$(js '[location.pathname + location.hash, window.__scape.offline.getState().drawing, JSON.stringify(window.__scape.offline.getState().draft)].join(" ")')
check "Esc: back in Settings, draft kept" "$([ "$e" = "/settings#offline false $before" ] && echo 1 || echo 0)" "$e"

# A drag draws the region and comes back.
js '(() => { [...document.querySelectorAll("#offline button")].find((b) => b.textContent.trim() === "Draw on the map").click(); return 1; })()' >/dev/null
wait_for 'location.pathname === "/" && !!window.__scapeMap?.loaded() && !!document.querySelector(".map-notice[data-kind=Drawing]")' 80
read -r x y <<<"$(js '(() => { const r = window.__scapeMap.getCanvas().getBoundingClientRect(); return Math.round(r.left + r.width * 0.3) + " " + Math.round(r.top + r.height * 0.3); })()')"
ab mouse move "$x" "$y" >/dev/null
ab mouse down >/dev/null
ab mouse move $((x + 80)) $((y + 60)) >/dev/null
ab mouse move $((x + 160)) $((y + 120)) >/dev/null
ab mouse up >/dev/null
wait_for 'location.pathname === "/settings" && !!document.getElementById("offline")' 40
d=$(js '(() => { const s = window.__scape.offline.getState(); return [location.pathname, s.drawing, !!s.draft && s.draft.east > s.draft.west && s.draft.north > s.draft.south, JSON.stringify(s.draft) !== JSON.stringify(s.mapView)].join(" "); })()')
check "Drag: region drawn, back in Settings" "$([ "$d" = '/settings false true true' ] && echo 1 || echo 0)" "$d"
js '(() => { window.__scape.offline.getState().setDraft(null); return 1; })()' >/dev/null

[ "$BRAVE" = 1 ] && brave_stop "$PROFILE" && rm -rf "$PROFILE"

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
