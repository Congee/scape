#!/usr/bin/env bash
# OpenFreeMap offline basemap smoke: pack Hoboken, go offline, render the map with labels from OPFS.
# Usage: scripts/smoke/basemap-ofm.sh [port] [cdp] [shot-dir]
set -uo pipefail

PORT=${1:-5401}
CDP=${2:-9401}
SHOTS=${3:-${TMPDIR:-/tmp}/basemap-ofm}
BASE="http://localhost:$PORT"
NAME=smoke-basemap-ofm
BBOX='{west:-74.045,south:40.735,east:-74.02,north:40.755}'
CENTRE='[-74.032,40.745]'
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
removeRegion() {
  js "(async()=>{const o=__scape.offline.getState(); for (const a of o.archives.filter(a=>a.name==='$NAME')) await o.remove(a.id); return __scape.offline.getState().archives.filter(a=>a.name==='$NAME').length})()"
}
offlineTab() {
  poll "(()=>{[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent==='Map')?.click(); return !!document.querySelector('select[aria-label=\"Basemap source\"]')})()" 20
}
# Rendered labels: symbol features that carry text.
LABELS="__scapeMap.queryRenderedFeatures().filter(f=>f.layer.type==='symbol'&&f.layer.layout?.['text-field']).length"

HOLDER=
online() { [ -n "$HOLDER" ] && kill "$HOLDER" 2>/dev/null; HOLDER=; }
trap online EXIT
ab set viewport 1440 900 >/dev/null
ab --init-script "$(cd "$(dirname "$0")" && pwd)/raf-shim.js" open "$BASE/" >/dev/null
poll "!!window.__scape && __scape.offline.getState().loaded && !!window.__scapeMap" 30
js "(()=>{__scape.settings.getState().update({basemapId:'ofm-liberty'}); return 1})()" >/dev/null
removeRegion >/dev/null

# Panel defaults, estimate and download.
js "(()=>{__scape.offline.getState().setDraft($BBOX); return 1})()" >/dev/null
offlineTab
src=$(js "document.querySelector('select[aria-label=\"Basemap source\"]').value+' '+document.querySelector('input[aria-label=\"Basemap source URL\"]').value+' z'+document.querySelector('select[aria-label=\"Highest basemap zoom\"]').value")
check "OpenFreeMap is the default source" "$([ "$src" = 'openfreemap https://tiles.openfreemap.org/planet z14' ] && echo 1 || echo 0)" "$src"
INCL="[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Include in the terrain download'))?.querySelector('input')?.checked"
small=$(js "$INCL")
js "(()=>{__scape.offline.getState().setDraft({west:-74.3,south:40.5,east:-73.7,north:40.95}); return 1})()" >/dev/null
ab wait 300 >/dev/null
big=$(js "$INCL")
js "(()=>{__scape.offline.getState().setDraft($BBOX); return 1})()" >/dev/null
ab wait 300 >/dev/null
check "basemap joins the terrain download by default up to 100 tiles" "$([ "$small" = true ] && [ "$big" = false ] && echo 1 || echo 0)" "Hoboken=$small, NYC=$big"
ab fill "input[aria-label='Name for the region']" "$NAME" >/dev/null
js "(()=>{[...document.querySelectorAll('button')].filter(b=>b.textContent==='Estimate')[0].click(); return 1})()" >/dev/null
poll "[...document.querySelectorAll('.actions .muted')].some(s=>/tiles ·/.test(s.textContent))" 30
est=$(js "[...document.querySelectorAll('.actions .muted')].find(s=>/tiles ·/.test(s.textContent)).textContent")
tiles=$(echo "$est" | sed -E 's/^([0-9,]+) tiles.*/\1/' | tr -d ,)
check "estimate: tiles and bytes, Hoboken <= 50 tiles" "$([ "${tiles:-99}" -le 50 ] && echo "$est" | grep -Eq '~[0-9.]+ [KM]B · build 20[0-9]{2}-' && echo 1 || echo 0)" "$est"
t0=$SECONDS
js "(()=>{[...document.querySelectorAll('button')].filter(b=>b.textContent==='Download')[0].click(); return 1})()" >/dev/null
poll "(()=>{const s=__scape.offline.getState(); return s.jobs.every(j=>j.state!=='Running') && s.archives.some(a=>a.name==='$NAME')})()" 180
meta=$(js "JSON.stringify(__scape.offline.getState().archives.filter(a=>a.name==='$NAME').map(a=>({id:a.id,kind:a.kind,z:a.minZoom+'-'+a.maxZoom,tiles:a.tileCount,bytes:a.bytes,style:a.style,src:a.sourceUrl})))")
ID=$(echo "$meta" | sed -E 's/.*"id":"([^"]+)".*/\1/')
check "archive saved with its style ($((SECONDS - t0)) s)" "$(echo "$meta" | grep -q '"style":"https://tiles.openfreemap.org/styles/liberty"' && echo "$meta" | grep -q '"z":"0-14"' && echo 1 || echo 0)" "$meta"
assets=$(js "(async()=>{const d=await (await (await navigator.storage.getDirectory()).getDirectoryHandle('archives')).getDirectoryHandle('$ID.assets'); const n=[]; for await (const k of d.keys()) n.push(decodeURIComponent(k)); return n.length+' files: '+['style.json','sprite@2x.png','fonts/Noto Sans Regular/0-255.pbf','fonts/Noto Sans Bold/1024-1279.pbf'].filter(f=>n.includes(f)).length+'/4 key files, '+n.filter(f=>f.startsWith('fonts/')).length+' glyph ranges'})()")
check "style, sprites and glyphs cached" "$(echo "$assets" | grep -q '4/4 key' && echo 1 || echo 0)" "$assets"
ab screenshot "$SHOTS/panel-desktop.png" >/dev/null

# Dev modules load on first use, which cannot happen offline: visit the viewfinder first.
js "(()=>{document.querySelector('a[href=\"/viewfinder\"]').click(); return 1})()" >/dev/null
poll "location.pathname==='/viewfinder' && !!__scape.prism" 30
js "(()=>{document.querySelector('a[href=\"/\"]').click(); return 1})()" >/dev/null
poll "location.pathname==='/' && !!window.__scapeMap" 30

js "(()=>{window.SharedWorker=undefined; return 1})()" >/dev/null
bun "$(dirname "$0")/cdp-offline.ts" "$CDP" "$PORT" &
HOLDER=$!
ab wait 1500 >/dev/null
net=$(js "fetch('https://tiles.openfreemap.org/planet', {cache:'no-store'}).then(()=>'online', ()=>'offline')")
check "network offline (CDP)" "$([ "$net" = offline ] && echo 1 || echo 0)" "$net"

# Pick the archive only now, so the style, sprites, glyphs and tiles all load offline.
js "(()=>{__scapeMap.jumpTo({center:$CENTRE,zoom:14.5,pitch:0,bearing:0}); return 1})()" >/dev/null
offlineTab
js "(()=>{[...document.querySelectorAll('li.archive')].find(l=>l.querySelector('input').value==='$NAME').querySelector('button.link').click(); return 1})()" >/dev/null
poll "__scapeMap.getStyle()?.glyphs?.startsWith('scape-asset://$ID/') && __scapeMap.loaded() && $LABELS>0" 40
st=$(js "(()=>{const s=__scapeMap.getStyle(); return Object.values(s.sources).filter(x=>x.type==='vector').map(x=>x.url).join(',')+' sprite='+(typeof s.sprite==='string'?s.sprite:'?')})()")
check "style reads the local archive" "$(echo "$st" | grep -q "pmtiles://opfs/$ID.pmtiles" && echo 1 || echo 0)" "$st"
ab wait 1500 >/dev/null
lab=$(js "$LABELS")
names=$(js "[...new Set(__scapeMap.queryRenderedFeatures().filter(f=>f.layer.type==='symbol'&&f.properties.name).map(f=>f.properties.name))].slice(0,4).join('; ')")
check "labels render offline" "$([ "${lab:-0}" -gt 0 ] && echo 1 || echo 0)" "$lab symbols ($names)"
fills=$(js "__scapeMap.queryRenderedFeatures().filter(f=>f.layer.type==='fill'||f.layer.type==='line').length")
check "vector features render offline" "$([ "${fills:-0}" -gt 0 ] && echo 1 || echo 0)" "$fills fill/line features"
attr=$(js "document.querySelector('.maplibregl-ctrl-attrib')?.textContent ?? ''")
check "attribution kept" "$(echo "$attr" | grep -q OpenMapTiles && echo "$attr" | grep -q OpenStreetMap && echo 1 || echo 0)" "$(echo "$attr" | tr -s ' ' | cut -c1-90)"
ab screenshot "$SHOTS/map-offline.png" >/dev/null
# Overzoom past the archive's z14 must still draw from it.
js "(()=>{__scapeMap.jumpTo({center:$CENTRE,zoom:16.5}); return 1})()" >/dev/null
poll "__scapeMap.loaded() && $LABELS>0" 30
check "overzoom z16.5 offline" "$([ "$(js "$LABELS")" -gt 0 ] && echo 1 || echo 0)" "$(js "$LABELS") symbols"
ab screenshot "$SHOTS/map-offline-z16.png" >/dev/null

# Viewfinder offline; it draws its own terrain and buildings, not a basemap texture.
js "(()=>{const w=__scape.world.getState(); w.setPin({lat:40.745,lng:-74.032}); w.setPin2({lat:40.7527,lng:-74.0}); return 1})()" >/dev/null
js "(()=>{document.querySelector('a[href=\"/viewfinder\"]').click(); return 1})()" >/dev/null
poll "location.pathname==='/viewfinder' && !!__scape.prism" 30
ab wait 2500 >/dev/null
ab screenshot "$SHOTS/viewfinder-offline.png" >/dev/null
vf=$(js "!!document.querySelector('canvas') && location.pathname")
check "viewfinder offline" "$([ "$vf" = /viewfinder ] && echo 1 || echo 0)" "$vf"

# Phone: map and Offline panel at 390x844, still offline.
ab set viewport 390 844 >/dev/null
js "(()=>{document.querySelector('a[href=\"/\"]').click(); return 1})()" >/dev/null
poll "location.pathname==='/' && !!window.__scapeMap && __scapeMap.loaded()" 30
ab wait 1500 >/dev/null
ab screenshot "$SHOTS/map-phone.png" >/dev/null
plab=$(js "$LABELS")
offlineTab
js "(()=>{document.querySelector('select[aria-label=\"Basemap source\"]').scrollIntoView({block:'center'}); return 1})()" >/dev/null
ab wait 500 >/dev/null
over=$(js "document.documentElement.scrollWidth > innerWidth")
seen=$(js "(()=>{const r=document.querySelector('select[aria-label=\"Basemap source\"]').getBoundingClientRect(); const u=document.querySelector('input[aria-label=\"Basemap source URL\"]').getBoundingClientRect(); return r.width>0 && r.right<=innerWidth && u.right<=innerWidth})()")
check "phone 390x844 map + panel" "$([ "$seen" = true ] && [ "$over" = false ] && [ "${plab:-0}" -gt 0 ] && echo 1 || echo 0)" "labels=$plab, source fields fit=$seen, h-scroll=$over"
ab screenshot "$SHOTS/panel-phone.png" >/dev/null

online
ab set viewport 1440 900 >/dev/null
ab wait 3000 >/dev/null
poll "!!window.__scape && __scape.offline.getState().loaded" 30
js "(()=>{__scape.settings.getState().update({basemapId:'ofm-liberty'}); return 1})()" >/dev/null
left=$(removeRegion)
gone=$(js "(async()=>{const d=await (await navigator.storage.getDirectory()).getDirectoryHandle('archives'); const n=[]; for await (const k of d.keys()) n.push(k); return n.filter(k=>k.startsWith('$ID')).length})()")
check "test region and its assets deleted" "$([ "$left" = 0 ] && [ "$gone" = 0 ] && echo 1 || echo 0)" "archives=$left, files=$gone"

echo "| check | result | detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "screenshots: $SHOTS"
exit $FAIL
