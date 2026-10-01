#!/usr/bin/env bash
# Smoke test for the light layer, first/last light, the light-source switch, the viewfinder moon and the orbit view.
# Usage: scripts/smoke/extras-light.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port and a browser with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5310}
CDP=${2:-9341}
OUT=${3:-${TMPDIR:-/tmp}/extras-light}
BASE="http://localhost:$PORT"
PNG="$(cd "$(dirname "$0")" && pwd)/png-sample.py"
mkdir -p "$OUT"

# Its own agent-browser session: "default" is shared with every other agent.
SESSION=${AGENT_BROWSER_SESSION:-smoke-$CDP}
ab() { agent-browser --cdp "${CDP:?no CDP port}" --session "$SESSION" "$@"; }
bun "$(dirname "$0")/reset.ts" "$CDP" "$BASE"
# agent-browser prints eval results JSON-encoded; strip the string quotes.
js() { ab eval "$1" | sed -e 's/^"//' -e 's/"$//' -e 's/\\"/"/g'; }

FAILS=0
ROWS=()
check() { # name, ok (0/1), detail
  local status=PASS
  if [ "$2" != 1 ]; then status=FAIL; FAILS=$((FAILS + 1)); fi
  ROWS+=("| $1 | $status | $3 |")
}

# Zermatt, facing the Matterhorn.
CAM="46.0207,7.7491"
TGT="45.9766,7.6586"
DAY="2026-10-18T09:00Z"
NIGHT="2026-10-25T21:00Z"
# 2026-10-13 dusk: sun +2.3° at 16:30, -1.4° at 16:50, -8.3° at 17:30 with a crescent moon up.
DUSK_SUN="2026-10-13T16:30Z"
DUSK_GAP="2026-10-13T16:50Z"
DUSK_MOON="2026-10-13T17:30Z"
# A valley floor under the Matterhorn's east face.
VALLEY="45.9960,7.7100"

wait_for() { # js condition, tries of 0.25 s
  local i
  for ((i = 0; i < ${2:-40}; i++)); do
    [ "$(js "!!($1)")" = true ] && return 0
    sleep 0.25
  done
  return 1
}

# Retries: a fresh navigation sometimes reports ERR_INTERNET_DISCONNECTED.
go() {
  local i
  for i in 1 2 3; do
    ab open "$1" >/dev/null 2>&1 && wait_for 'window.__scape && document.querySelector(".tabs button")' && return 0
    sleep 1
  done
  return 1
}

# A background window gets no animation frames; each screenshot forces one.
frames() { # screenshot path, count
  local i
  for ((i = 0; i < ${2:-3}; i++)); do
    ab screenshot "$1" >/dev/null
    sleep 0.3
  done
}

set_time() { js "(() => { window.__scape.world.getState().setTime(Date.parse('$1')); return 'ok'; })()" >/dev/null; }
set_light() { js "(() => { window.__scape.settings.getState().update({ lightSource: '$1' }); return 'ok'; })()" >/dev/null; }

TERRAIN0=$(js 'window.__scape ? window.__scape.settings.getState().terrain : true' 2>/dev/null || echo true)
restore() {
  js "(() => { const s = window.__scape.settings.getState(); s.update({ terrain: ${TERRAIN0:-true}, lightSource: 'Auto' }); window.__scape.ui.getState().setOrbit('Off'); return 'ok'; })()" >/dev/null 2>&1
  ab set viewport 1400 900 >/dev/null 2>&1
}

# Map mask: the light the layer is lit by and the shaded share, once a new mask lands.
map_light() { # instant, screenshot → "body shaded%"
  # Zermatt and the Matterhorn's north face in one view; the page fits camera and target on load.
  js '(() => { window.__maskWas = window.__scape.buildings.getState().shadowMask; window.__scapeMap.jumpTo({ center: [7.7, 46.0], zoom: 12, pitch: 0, bearing: 0 }); return "ok"; })()' >/dev/null
  set_time "$1"
  local i
  for i in $(seq 1 40); do
    ab screenshot "$2" >/dev/null
    [ "$(js '(() => { const c = window.__scapeMapCtl; const m = window.__scape.buildings.getState().shadowMask; return c.lightBody === null || (!!m && m !== window.__maskWas); })()')" = true ] && break
    sleep 0.25
  done
  sleep 0.5
  ab screenshot "$2" >/dev/null
  js '(() => { const c = window.__scapeMapCtl; const m = window.__scape.buildings.getState().shadowMask; const vis = window.__scapeMap.getLayoutProperty("sun-shadow", "visibility"); let n = 0; if (m) for (const v of m.mask) if (v > 127) n++; return `${c.lightBody} ${vis} ${m ? ((100 * n) / m.mask.length).toFixed(1) : -1}`; })()'
}

ab set viewport 1400 900 >/dev/null
go "$BASE/?camera=$CAM&target=$TGT&t=$DAY"
js '(() => { window.__scape.settings.getState().update({ terrain: true, showSunShadows: true, lightSource: "Auto" }); return "ok"; })()' >/dev/null
wait_for 'window.__scape.terrain.getState().horizon' 120
sleep 1

# 1. Light layer by day and by night.
read -r body vis pct <<<"$(map_light "$DAY" "$OUT/map-light-day.png")"
check "map light layer, day (sun +26.7°)" "$([ "$body" = Sun ] && [ "$vis" = visible ] && awk -v p="$pct" 'BEGIN { exit !(p > 1 && p < 99) }' && echo 1 || echo 0)" "$body, $vis, $pct% shaded"
read -r body vis pct <<<"$(map_light "$NIGHT" "$OUT/map-light-night.png")"
check "map light layer, night (full moon +50.6°)" "$([ "$body" = Moon ] && [ "$vis" = visible ] && awk -v p="$pct" 'BEGIN { exit !(p > 0.1 && p < 99) }' && echo 1 || echo 0)" "$body, $vis, $pct% shaded"

# 2. Auto switch across dusk, then the override.
read -r body vis _ <<<"$(map_light "$DUSK_SUN" "$OUT/map-dusk-sun.png")"
check "auto light 16:30Z: sun +2.3°" "$([ "$body" = Sun ] && echo 1 || echo 0)" "$body, $vis"
read -r body vis _ <<<"$(map_light "$DUSK_GAP" "$OUT/map-dusk-gap.png")"
check "auto light 16:50Z: sun -1.4°, gap" "$([ "$body" = null ] && [ "$vis" = none ] && echo 1 || echo 0)" "$body, $vis"
read -r body vis _ <<<"$(map_light "$DUSK_MOON" "$OUT/map-dusk-moon.png")"
check "auto light 17:30Z: sun -8.3°, moon up" "$([ "$body" = Moon ] && [ "$vis" = visible ] && echo 1 || echo 0)" "$body, $vis"
set_light Sun
read -r body vis _ <<<"$(map_light "$DUSK_MOON" "$OUT/map-hold-sun.png")"
check "override Sun at 17:30Z: no light" "$([ "$body" = null ] && echo 1 || echo 0)" "$body, $vis"
set_light Moon
read -r body vis _ <<<"$(map_light "$DUSK_SUN" "$OUT/map-hold-moon.png")"
check "override Moon at 16:30Z: moon light" "$([ "$body" = Moon ] && echo 1 || echo 0)" "$body, $vis"
set_light Auto

# 3. First and last light at a valley point.
set_time "$DAY"
js '[...document.querySelectorAll(".tabs button")].find((b) => b.textContent === "Sky")?.click(); "ok"' >/dev/null
js "(() => { window.__scape.lightProbe.getState().setPoint({ lat: ${VALLEY%,*}, lng: ${VALLEY#*,} }); return 'ok'; })()" >/dev/null
wait_for 'window.__scape.lightProbe.getState().light || window.__scape.lightProbe.getState().error' 120
probe=$(js '(() => { const p = window.__scape.lightProbe.getState(); const l = p.light; if (!l) return "error " + p.error; return `${l.first} ${l.last} ${l.litMs} ${l.litNow}`; })()')
read -r first last lit now <<<"$probe"
# Flat-horizon sunrise and sunset at Zermatt that day are about 05:50Z and 16:25Z.
check "first/last light at the valley point, terrain-late and early" "$(awk -v a="$first" -v b="$last" -v r="$(date -u -j -f %Y-%m-%dT%H:%MZ 2026-10-18T05:50Z +%s)000" -v s="$(date -u -j -f %Y-%m-%dT%H:%MZ 2026-10-18T16:25Z +%s)000" 'BEGIN { exit !(a > r && b < s && a < b) }' && echo 1 || echo 0)" "$(date -u -r $((first / 1000)) +%H:%MZ) to $(date -u -r $((last / 1000)) +%H:%MZ), $((lit / 60000)) min lit, now $now"
js 'document.querySelectorAll(".tools details").forEach((d) => { d.open = true; }); "ok"' >/dev/null
sleep 0.3
cells=$(js '(() => { const f = document.querySelector("[data-probe=first]"); const l = document.querySelector("[data-probe=last]"); return f && l ? `${f.textContent} / ${l.textContent}` : "missing"; })()')
check "first/last light readout in Sky" "$([[ $cells == *[0-9]:[0-9][0-9]*/*[0-9]:[0-9][0-9]* ]] && echo 1 || echo 0)" "$cells"
frames "$OUT/probe-tools.png" 2
moon=$(js '(() => { const g = [...document.querySelectorAll(".tools details")].find((d) => d.querySelector("summary").textContent.startsWith("Moon")); return g ? g.querySelector("summary").textContent : "missing"; })()')
check "moon simulator group in Sky" "$([[ $moon == Moon*lit* ]] && echo 1 || echo 0)" "$moon"

# 4. Viewfinder moon at 2400 mm: crescent, quarter, full × landscape, portrait.
moon_disc() { # tag, instant, expected lit fraction class (thin|half|full), orientation
  go "$BASE/viewfinder?camera=$CAM&t=$2&f=2400$([ "$4" = P ] && echo '&o=p')"
  sleep 1
  # The low crescent sits behind the Matterhorn's shoulder; a flat horizon keeps the disc whole.
  js "(() => { window.__scape.settings.getState().update({ terrain: false }); return 'ok'; })()" >/dev/null
  local aim; aim=$(cd "$(dirname "$PNG")/../.." && bun -e "import { makeObserver, SkyBody } from './src/lib/core/astro/bodies'; import { position } from './src/lib/core/astro/positions'; const p = position(SkyBody.Moon, new Date('$2'), makeObserver({ lat: ${CAM%,*}, lng: ${CAM#*,} }, 1608)); console.log(p.azimuth, p.altitude);")
  js "(() => { window.__scape.composition.getState().aim(${aim% *}, ${aim#* }); window.__moonFrom = Date.now(); return 'ok'; })()" >/dev/null
  local shot="$OUT/moon-$1-$4.png" i
  for i in 1 2 3 4 5 6; do
    ab screenshot "$shot" >/dev/null
    [ "$(js '!!(window.__scape.moonDisc && window.__scape.moonDisc.at > window.__moonFrom)')" = true ] && break
    sleep 0.5
  done
  sleep 1
  frames "$shot" 2
  local g; g=$(js '(() => { const m = window.__scape.moonDisc; return m ? `${m.x} ${m.y} ${m.radiusPx} ${m.limbFromUpDeg} ${m.illumination} ${devicePixelRatio}` : "none"; })()')
  local x y r th k dpr; read -r x y r th k dpr <<<"$g"
  local lit dark mid; read -r lit dark mid <<<"$(python3 "$PNG" limb "$shot" "$dpr" "$x" "$y" "$r" "$th")"
  local pass=0
  case $3 in
  thin | half) awk -v a="$lit" -v b="$dark" 'BEGIN { exit !(a > b + 40) }' && pass=1 ;;
  full) awk -v a="$lit" -v b="$dark" -v c="$mid" 'BEGIN { exit !(a > 120 && b > 120 && c > 120) }' && pass=1 ;;
  esac
  check "moon 2400 mm $4 $1 ($(printf %.0f "$(echo "$k * 100" | bc -l)")% lit, limb $(printf %.0f "$th")° from up)" "$pass" "r $(printf %.0f "$r") px, lit side $lit, dark side $dark, centre $mid"
}
for o in L P; do
  moon_disc crescent "$DUSK_GAP" thin "$o"
  moon_disc quarter 2026-10-18T18:00Z half "$o"
  moon_disc full 2026-10-26T04:00Z full "$o"
done
js "(() => { window.__scape.settings.getState().update({ terrain: true }); return 'ok'; })()" >/dev/null

# 5. Viewfinder at the Matterhorn: focal × orientation × day/night; the shading follows the map's light.
vf() { # focal, orientation, instant, expected light, tag
  go "$BASE/viewfinder?camera=$CAM&target=$TGT&t=$3&f=$1$([ "$2" = P ] && echo '&o=p')"
  local shot="$OUT/vf-$1-$2-$5.png"
  wait_for 'window.__scape.prism && window.__scape.prism.shadow' 40
  frames "$shot" 4
  local light; light=$(js '(() => { const p = window.__scape.prism; return p && p.shadow ? String(p.shadow.light) : "none"; })()')
  local box; box=$(js '(() => { const c = document.querySelector("canvas"); const r = c.getBoundingClientRect(); return `${devicePixelRatio} ${r.left + 4} ${r.top + 4} ${r.right - 4} ${r.bottom - 4}`; })()')
  local spread; spread=$(python3 "$PNG" spread "$shot" $box)
  check "viewfinder ${1} mm $2 $5" "$([ "$light" = "$4" ] && awk -v s="$spread" 'BEGIN { exit !(s > 2) }' && echo 1 || echo 0)" "light $light, picture spread $spread"
}
for f in 24 200 600 2400; do
  for o in L P; do
    vf "$f" "$o" "$DAY" Sun day
    vf "$f" "$o" "$NIGHT" Moon night
  done
done

# 6. Orbit view, desktop and phone.
orbit() { # tag
  go "$BASE/?camera=$CAM&target=$TGT&t=$DAY"
  wait_for 'window.__scapeMapCtl && window.__scape.terrain.getState().pin2GroundM' 120
  js '[...document.querySelectorAll(".tabs button")].find((b) => b.textContent === "Map")?.click(); "ok"' >/dev/null
  sleep 0.5
  local via=store
  if [ "$(js '!!document.querySelector("select[aria-label=\"Orbit the 3D map\"]")')" = true ]; then
    ab select 'select[aria-label="Orbit the 3D map"]' Target >/dev/null 2>&1 && via=select
  fi
  [ "$(js 'window.__scape.ui.getState().orbit')" = Target ] || js '(() => { window.__scape.ui.getState().setOrbit("Target", true); return "ok"; })()' >/dev/null
  local shot="$OUT/orbit-$1.png"
  frames "$shot" 8
  local b0; b0=$(js 'window.__scapeMap.getBearing()')
  local t0; t0=$(date +%s)
  frames "$shot" 8
  local g; g=$(js '(() => { const m = window.__scapeMap; const p = window.__scape.world.getState().pin2; const q = m.project([p.lng, p.lat]); const c = m.getCanvas().getBoundingClientRect(); return `${m.getPitch().toFixed(1)} ${m.getBearing()} ${(q.x - c.width / 2).toFixed(0)} ${(q.y - c.height / 2).toFixed(0)} ${c.width.toFixed(0)} ${c.height.toFixed(0)} ${document.documentElement.scrollWidth > window.innerWidth}`; })()')
  local dt=$(($(date +%s) - t0))
  local pitch b1 dx dy w h wide; read -r pitch b1 dx dy w h wide <<<"$g"
  local turned; turned=$(awk -v a="$b0" -v b="$b1" 'BEGIN { d = b - a; while (d < 0) d += 360; while (d >= 360) d -= 360; printf "%.1f", d }')
  check "orbit $1: pitch 60–80°, below 90°" "$(awk -v p="$pitch" 'BEGIN { exit !(p >= 60 && p <= 80) }' && echo 1 || echo 0)" "pitch $pitch (set via $via)"
  check "orbit $1: turning" "$(awk -v d="$turned" 'BEGIN { exit !(d > 0.5 && d < 120) }' && echo 1 || echo 0)" "+${turned}° in ${dt} s"
  check "orbit $1: target held at the centre" "$(awk -v x="$dx" -v y="$dy" -v w="$w" -v h="$h" 'BEGIN { exit !(x * x < (w * 0.05) ^ 2 && y * y < (h * 0.05) ^ 2) }' && echo 1 || echo 0)" "off by $dx, $dy px of ${w}×${h}"
  local fov; fov=$(js '(() => { const m = window.__scapeMap; const n = (id) => { const d = m.getSource(id)?.serialize().data; return d && d.features ? d.features.length : 0; }; const layers = m.getStyle().layers.filter((l) => l.source === "fov" && m.getLayoutProperty(l.id, "visibility") !== "none").length; return `fov ${n("fov")} in ${layers} layers, markers ${document.querySelectorAll(".maplibregl-marker").length}`; })()')
  check "orbit $1: FOV cone, sightline and markers still drawn" "$([[ $fov =~ ^fov\ [1-9].*in\ [1-9].*markers\ [1-9] ]] && echo 1 || echo 0)" "$fov"
  check "orbit $1: no sideways page scroll" "$([ "$wide" = false ] && echo 1 || echo 0)" "overflow $wide"
  js '(() => { window.__scape.ui.getState().setOrbit("Off"); return "ok"; })()' >/dev/null
  frames "$OUT/orbit-$1-off.png" 3
  local after; after=$(js 'window.__scapeMap.getPitch().toFixed(1)')
  check "orbit $1: off returns pitch under 60°" "$(awk -v p="$after" 'BEGIN { exit !(p <= 60) }' && echo 1 || echo 0)" "pitch $after"
}
orbit desktop
ab set viewport 390 844 >/dev/null
orbit phone

# Phone Sky panel with the new groups.
go "$BASE/?camera=$CAM&target=$TGT&t=$DAY"
js '[...document.querySelectorAll(".tabs button")].find((b) => b.textContent === "Sky")?.click(); "ok"' >/dev/null
sleep 0.5
js 'document.querySelectorAll(".tools details").forEach((d) => { d.open = true; }); "ok"' >/dev/null
js '(() => { const d = [...document.querySelectorAll(".tools details")].find((g) => g.querySelector("summary").textContent.startsWith("Light at")); d?.scrollIntoView(); return "ok"; })()' >/dev/null
frames "$OUT/phone-tools.png" 2
wide=$(js 'document.documentElement.scrollWidth > window.innerWidth')
check "phone 390×844 Sky: no sideways page scroll" "$([ "$wide" = false ] && echo 1 || echo 0)" "overflow $wide"

restore
echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
