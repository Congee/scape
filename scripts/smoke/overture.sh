#!/usr/bin/env bash
# Overture buildings smoke: a first load resolves the release once, a reload takes the remembered one without asking, and the map and viewfinder show buildings with no 404.
# Usage: scripts/smoke/overture.sh [port] [cdp] [shot-dir]
set -uo pipefail

PORT=${1:-5487}
CDP=${2:-9487}
SHOTS=${3:-${TMPDIR:-/tmp}/overture}
BASE="http://localhost:$PORT"
# Hoboken waterfront looking at Hudson Yards: no LoD2 region, so the viewfinder draws Overture prisms.
CAMERA=40.7440,-74.0270
TARGET=40.75376,-74.00066
# Rotterdam centre for the map.
MAP=51.9225,4.4792
LISTING='https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/?list-type=2&prefix=tiles/'
mkdir -p "$SHOTS"

# Its own agent-browser session: "default" is shared with every other agent.
SESSION=${AGENT_BROWSER_SESSION:-smoke-$CDP}
ab() { agent-browser --cdp "${CDP:?no CDP port}" --session "$SESSION" "$@"; }
bun "$(dirname "$0")/reset.ts" "$CDP" "$BASE"
js() { ab eval "$1" | sed -e 's/^"//' -e 's/"$//' -e 's/\\"/"/g'; }
declare -a ROWS
FAIL=0
check() { # name, ok(0/1), detail
  if [ "$2" = 1 ]; then ROWS+=("| $1 | PASS | $3 |"); else ROWS+=("| $1 | FAIL | $3 |"); FAIL=1; fi
}
poll() { # js boolean expression, timeout seconds
  local end=$((SECONDS + $2))
  while [ $SECONDS -lt $end ]; do
    [ "$(js "$1")" = true ] && return 0
    ab wait 1000 >/dev/null
  done
  return 1
}
# Main-thread resource entries for the bucket; workers keep their own timelines.
BUCKET="performance.getEntriesByType('resource').filter(e=>e.name.includes('overturemaps-extras'))"

newest=$(curl -s "$LISTING" | grep -o 'tiles/[0-9-]*\.[0-9]*/buildings\.pmtiles' | sort -V | tail -1 | cut -d/ -f2)
ab set viewport 1440 900 >/dev/null
DIR=$(cd "$(dirname "$0")" && pwd)
ab --init-script "$DIR/raf-shim.js" --init-script "$DIR/overture-init.js" open "$BASE/" >/dev/null
poll "!!window.__scape && !!window.__scapeMap" 30
js "(()=>{const w=__scape.world.getState(); w.setPin({lat:${MAP%,*},lng:${MAP#*,}}); w.setPin2(null); __scapeMap.jumpTo({center:[${MAP#*,},${MAP%,*}],zoom:15.5,pitch:0}); return 1})()" >/dev/null
Q="__scapeMap.queryRenderedFeatures({layers:['overture-building','overture-building-part']}).length"
poll "__scapeMap.loaded() && $Q>0" 40
n=$(js "$Q")
check "map: Overture buildings in Rotterdam z15.5" "$([ "${n:-0}" -gt 0 ] && echo 1 || echo 0)" "$n features"
ab screenshot "$SHOTS/map-rotterdam.png" >/dev/null

js "(()=>{document.querySelector('a[href^=\"/viewfinder\"]').click(); return 1})()" >/dev/null
poll "location.pathname==='/viewfinder' && !!__scape.prism" 30
js "(()=>{const w=__scape.world.getState(); w.setTime(Date.parse('2026-09-24T19:00Z')); w.setPin({lat:${CAMERA%,*},lng:${CAMERA#*,}}); w.setPin2({lat:${TARGET%,*},lng:${TARGET#*,}}); __scape.composition.getState().update({focalMm:200}); __scape.composition.setState({aimLock:'Target'}); return 1})()" >/dev/null
poll "(__scape.prism?.buildings ?? 0) > 0 && __scape.buildings.getState().busy===false" 60
v=$(js "__scape.prism?.buildings ?? 0")
check "viewfinder: Overture prisms, Hudson Yards at 200 mm" "$([ "${v:-0}" -gt 0 ] && echo 1 || echo 0)" "prism.buildings=$v"
ab screenshot "$SHOTS/viewfinder-nyc.png" >/dev/null

lists=$(js "$BUCKET.filter(e=>e.name.includes('list-type=2')).length")
check "first load lists the release once" "$([ "$lists" = 1 ] && echo 1 || echo 0)" "$lists listing requests"
used=$(js "[...new Set($BUCKET.map(e=>/tiles\/([^/]+)\/buildings/.exec(e.name)?.[1]).filter(Boolean))].join(' ')")
check "map reads the newest release" "$([ -n "$newest" ] && [ "$used" = "$newest" ] && echo 1 || echo 0)" "read '$used', newest '$newest'"
bad=$(js "$BUCKET.filter(e=>e.responseStatus>=400).length")
check "no failed bucket request" "$([ "$bad" = 0 ] && echo 1 || echo 0)" "$bad failed"

# Reload with every release remembered: nothing may ask a publisher before (or after) the first building tile.
ASKS="performance.getEntriesByType('resource').filter(e=>/list-type=2|swissbuildings3d\\.3d\\/v1\\/tileset\\.json|3dbag\\.nl\\/latest\\//.test(e.name))"
remembered=$(js "Object.keys(JSON.parse(localStorage.getItem('scape.releases')??'{}')).sort().join(' ')")
ab --init-script "$DIR/raf-shim.js" --init-script "$DIR/overture-init.js" open "$BASE/" >/dev/null
poll "!!window.__scape && !!window.__scapeMap" 30
js "(()=>{const w=__scape.world.getState(); w.setPin({lat:${MAP%,*},lng:${MAP#*,}}); w.setPin2(null); __scapeMap.jumpTo({center:[${MAP#*,},${MAP%,*}],zoom:15.5,pitch:0}); return 1})()" >/dev/null
poll "__scapeMap.loaded() && $Q>0" 40
tiles=$(js "$BUCKET.filter(e=>e.name.includes('buildings.pmtiles')).length")
asks=$(js "$ASKS.map(e=>e.name).join(' ')")
check "reload: remembered releases, no listing before the first tile" "$([ "$remembered" = 'Bag3d Overture Swiss' ] && [ "${tiles:-0}" -gt 0 ] && [ -z "$asks" ] && echo 1 || echo 0)" "remembered '$remembered', $tiles tile reads, asks '${asks:-none}'"

echo "| check | result | detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "screenshots: $SHOTS"
exit $FAIL
