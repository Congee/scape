#!/usr/bin/env bash
# Offline buildings smoke: download a Hoboken–Hudson Yards region, go offline, check viewfinder, map and panel.
# Usage: scripts/smoke/offline-buildings.sh [port] [cdp] [shot-dir]
set -uo pipefail

PORT=${1:-5280}
CDP=${2:-9338}
SHOTS=${3:-${TMPDIR:-/tmp}/offline-buildings}
BASE="http://localhost:$PORT"
NAME=smoke-offline-buildings
CAMERA=40.7440,-74.0270
TARGET=40.75376,-74.00066
DAY=2026-09-24T19:00Z
NIGHT=2026-09-25T02:00Z
mkdir -p "$SHOTS"

# Own session: the default one is shared with other agents driving other browsers.
ab() { agent-browser --cdp "$CDP" --session "${AB_SESSION:-offline-buildings}" "$@"; }
js() { ab eval "$1" | sed -e 's/^"//' -e 's/"$//'; }
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
removeRegion() {
  js "(async()=>{const o=__scape.offline.getState(); for (const a of o.archives.filter(a=>a.name==='$NAME')) await o.remove(a.id); return __scape.offline.getState().archives.filter(a=>a.name==='$NAME').length})()"
}

HOLDER=
online() { [ -n "$HOLDER" ] && kill "$HOLDER" 2>/dev/null; HOLDER=; }
trap online EXIT
ab set viewport 1440 900 >/dev/null
# Start far away so no New York building tile is fetched live before going offline.
ab --init-script "$(cd "$(dirname "$0")" && pwd)/raf-shim.js" open "$BASE/" >/dev/null
poll "!!window.__scape && __scape.offline.getState().loaded" 30
js "(()=>{const w=__scape.world.getState(); w.setPin({lat:46.02,lng:7.75}); w.setPin2(null); w.setView({center:{lat:46.02,lng:7.75},zoom:12}); return 1})()" >/dev/null
removeRegion >/dev/null
ab open "$BASE/" >/dev/null
poll "!!window.__scape && __scape.offline.getState().loaded" 30

# Download through the panel: terrain, with buildings on by default for a small region.
js "(()=>{__scape.offline.getState().setDraft({west:-74.035,south:40.735,east:-73.995,north:40.76}); return 1})()" >/dev/null
poll "(()=>{[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent==='Offline')?.click(); return !!document.querySelector('input[aria-label=\"Name for the region\"]')})()" 20
ab fill "input[aria-label='Name for the region']" "$NAME" >/dev/null
on=$(js "document.querySelector('input[type=checkbox][aria-label^=\"Download with the terrain\"]')?.checked ?? [...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Download with the terrain'))?.querySelector('input')?.checked")
check "buildings on by default (6 tiles)" "$([ "$on" = true ] && echo 1 || echo 0)" "checkbox=$on"
js "(()=>{const f=[...document.querySelectorAll('button')].filter(b=>b.textContent==='Download'); f[1].click(); return f.length})()" >/dev/null
poll "(()=>{const s=__scape.offline.getState(); return s.jobs.every(j=>j.state!=='Running') && ['terrain','buildings'].every(k=>s.archives.some(a=>a.name==='$NAME'&&a.kind===k))})()" 240
bld=$(js "JSON.stringify(__scape.offline.getState().archives.filter(a=>a.name==='$NAME').map(a=>[a.kind,a.tileCount,a.bytes]))")
check "terrain + buildings archives saved" "$(echo "$bld" | grep -q buildings && echo "$bld" | grep -q terrain && echo 1 || echo 0)" "$bld"
ab screenshot "$SHOTS/panel-desktop.png" >/dev/null

# Dev modules load on first use, which cannot happen offline: visit the viewfinder route and the height lookup first.
js "(()=>{document.querySelector('a[href=\"/viewfinder\"]').click(); return 1})()" >/dev/null
poll "location.pathname==='/viewfinder' && !!__scape.prism" 30
js "(()=>{document.querySelector('a[href=\"/\"]').click(); return 1})()" >/dev/null
poll "location.pathname==='/' && !!window.__scapeMap" 30
js "import('/src/lib/state/buildings.ts').then(()=>1)" >/dev/null
js "(()=>{__scape.world.getState().setTime(Date.parse('2026-09-24T10:00Z')); return 1})()" >/dev/null
poll "!!__scape.buildings.getState().shadowMask" 30

# Vite pings its dev server from a SharedWorker, which page emulation misses, and would reload the page offline.
js "(()=>{window.SharedWorker=undefined; return 1})()" >/dev/null
bun "$(dirname "$0")/cdp-offline.ts" "$CDP" "$PORT" &
HOLDER=$!
ab wait 1500 >/dev/null
net=$(js "fetch('https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/', {cache:'no-store', mode:'no-cors'}).then(()=>'online', ()=>'offline')")
check "network offline (CDP)" "$([ "$net" = offline ] && echo 1 || echo 0)" "$net"

# Map: shift-click the target like a user, then look for extrusions and the shadow mask.
js "(()=>{const w=__scape.world.getState(); w.setTime(Date.parse('$DAY')); w.setPin({lat:${CAMERA%,*},lng:${CAMERA#*,}}); w.setPin2(null); w.setPin2Height(0,false); __scape.buildings.setState({shadowMask:null}); __scapeMap.jumpTo({center:[${TARGET#*,},${TARGET%,*}],zoom:16,pitch:50}); return 1})()" >/dev/null
poll "__scapeMap.loaded() && __scapeMap.queryRenderedFeatures({layers:['overture-building','overture-building-part']}).length>0" 30
js "(()=>{const ll={lng:${TARGET#*,},lat:${TARGET%,*}}; __scapeMap.fire('click',{lngLat:ll,point:__scapeMap.project([ll.lng,ll.lat]),originalEvent:{shiftKey:true,altKey:false}}); return 1})()" >/dev/null
poll "__scape.world.getState().pin2HeightAuto" 20
h=$(js "__scape.world.getState().pin2HeightM")
direct=$(js "(async()=>{const m=await import('/src/lib/state/buildings.ts'); return String(await m.buildingHeightAt({lat:${TARGET%,*},lng:${TARGET#*,}}))})()")
check "target takes building height (~395 m)" "$([ "${h:-0}" -ge 380 ] && [ "${h:-0}" -le 410 ] && echo 1 || echo 0)" "pin2 ${h} m, worker ${direct} m"
ext=$(js "__scapeMap.queryRenderedFeatures({layers:['overture-building','overture-building-part']}).length")
check "map extrusions offline" "$([ "${ext:-0}" -gt 0 ] && echo 1 || echo 0)" "$ext features"
poll "__scape.buildings.getState().shadowMask?.centre.lat>40" 30
sh=$(js "(()=>{const m=__scape.buildings.getState().shadowMask; return m?.centre.lat>40 ? 'mask '+m.nx+'x'+m.ny+' @'+m.cellM+' m' : 'none'})()")
check "map shadows offline" "$([ "$sh" != none ] && echo 1 || echo 0)" "$sh"
ab wait 1500 >/dev/null
ab screenshot "$SHOTS/map-offline.png" >/dev/null
# Negative control: a tile outside the region must not answer while offline.
miss=$(js "(async()=>{const m=await import('/src/lib/state/buildings.ts'); return String(await m.buildingHeightAt({lat:40.7516,lng:-73.9755}))})()")
check "outside region stays empty offline" "$([ "$miss" = null ] && echo 1 || echo 0)" "Chrysler height=$miss"

# Viewfinder matrix, entered in-app since a page load cannot happen offline.
js "(()=>{document.querySelector('a[href=\"/viewfinder\"]').click(); return 1})()" >/dev/null
poll "location.pathname==='/viewfinder' && !!__scape.prism" 30
for f in 24 200 600 2400; do
  for o in Landscape Portrait; do
    for tod in day night; do
      t=$DAY; [ $tod = night ] && t=$NIGHT
      js "(()=>{__scape.world.getState().setTime(Date.parse('$t')); __scape.composition.getState().update({focalMm:$f, orientation:'$o'}); __scape.composition.setState({aimAtTarget:true}); return 1})()" >/dev/null
      ab wait 2500 >/dev/null
      poll "__scape.buildings.getState().busy===false" 20
      n=$(js "__scape.prism?.buildings ?? 0")
      shot="$SHOTS/vf-${f}mm-$o-$tod.png"
      ab screenshot "$shot" >/dev/null
      check "viewfinder ${f}mm $o $tod" "$([ "${n:-0}" -gt 0 ] && echo 1 || echo 0)" "prism.buildings=$n"
    done
  done
done

# Phone: the Offline panel at 390x844.
ab set viewport 390 844 >/dev/null
js "(()=>{document.querySelector('a[href=\"/\"]').click(); return 1})()" >/dev/null
ab wait 1500 >/dev/null
js "(()=>{[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent==='Offline')?.click(); return 1})()" >/dev/null
ab wait 800 >/dev/null
js "(()=>{document.querySelector('input[type=checkbox]')?.closest('section,div')?.scrollIntoView(); return 1})()" >/dev/null
over=$(js "document.documentElement.scrollWidth > innerWidth")
seen=$(js "[...document.querySelectorAll('label')].some(l=>l.textContent.startsWith('Download with the terrain') && l.getBoundingClientRect().width>0 && l.getBoundingClientRect().right<=innerWidth)")
check "phone 390x844 Offline panel" "$([ "$seen" = true ] && [ "$over" = false ] && echo 1 || echo 0)" "toggle visible=$seen, h-scroll=$over"
ab screenshot "$SHOTS/panel-phone.png" >/dev/null

online
ab set viewport 1440 900 >/dev/null
# Vite reloads once its server answers again.
ab wait 3000 >/dev/null
poll "!!window.__scape && __scape.offline.getState().loaded" 30
left=$(removeRegion)
check "test region deleted" "$([ "$left" = 0 ] && echo 1 || echo 0)" "remaining=$left"

echo "| check | result | detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "screenshots: $SHOTS"
exit $FAIL
