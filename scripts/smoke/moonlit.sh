#!/usr/bin/env bash
# Smoke for moonlight: buildings at the ground's moonlit night level in the viewfinder (Rotterdam, full and new Moon),
# neutral grey moon shade on the map, and the map's live Moon line turning copper through the 2025-09-07 lunar eclipse.
# Usage: scripts/smoke/moonlit.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port, a browser with remote debugging on the CDP port, and uv (for pixel sampling).
set -uo pipefail

PORT=${1:-5510}
CDP=${2:-9510}
OUT=${3:-${TMPDIR:-/tmp}/moonlit}
BASE="http://localhost:$PORT"
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
ok() { awk "BEGIN { exit !($1) }" && echo 1 || echo 0; }

wait_for() { # js condition, tries of 0.5 s; each screenshot forces a frame in a background window
  local i
  for ((i = 0; i < ${2:-60}; i++)); do
    [ "$(js "!!($1)")" = true ] && return 0
    ab screenshot "$OUT/.frame.png" >/dev/null 2>&1
    sleep 0.5
  done
  return 1
}

go() { # url, ready condition
  local i
  for i in 1 2 3; do
    ab open "$1" >/dev/null 2>&1 && wait_for 'window.__scape' 40 && break
    sleep 1
  done
  js '(() => { window.__scape.settings.getState().update({ terrain: true, showSunShadows: true, lightSource: "Auto" }); window.__scape.composition.getState().update({ showBuildings: true }); return "ok"; })()' >/dev/null
  wait_for "$2" 120
}

# Behind De Rotterdam's full Moon, looking at the towers.
CAM="51.9030,4.4895"
TGT="51.9066,4.4880"
DAY="2026-09-27T12:00Z"
FULL="2026-09-26T22:30Z"
NEW="2026-10-10T22:30Z"
READY='(() => { const p = window.__scape.prism; return p && p.lod2 && !p.lod2.busy && p.lod2.tiles > 0 && p.modelTris > 0 && !window.__scape.buildings.getState().busy; })()'

# Median luma of building pixels (luma > 45) in the canvas's upper 45%, where only sky, stars and buildings sit.
bright() { # png
  local box; box=$(js '(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return `${r.left + 4} ${r.top + 4} ${r.right - 4} ${r.top + r.height * 0.45} ${window.innerWidth}`; })()')
  # shellcheck disable=SC2086
  uv run -q --with pillow python3 - "$1" $box <<'PY'
import sys
from PIL import Image
img = Image.open(sys.argv[1]).convert("RGB")
x0, y0, x1, y1, vw = map(float, sys.argv[2:])
k = img.width / vw
step = max(1, int(k))
ls = sorted(l for x in range(int(x0 * k), int(x1 * k), step) for y in range(int(y0 * k), int(y1 * k), step)
            for l in [0.2126 * img.getpixel((x, y))[0] + 0.7152 * img.getpixel((x, y))[1] + 0.0722 * img.getpixel((x, y))[2]] if l > 45)
print(round(ls[len(ls) // 2]) if len(ls) > 200 else 0, len(ls))
PY
}

vf_url() { # instant, focal, orientation
  echo "$BASE/viewfinder?camera=$CAM&target=$TGT&t=$1&f=$2$([ "$3" = P ] && echo '&o=p')"
}

vf_case() { # label, instant tag, focal, orientation; sets LAST, N and LOD2
  local inst png
  case $2 in day) inst=$DAY ;; full) inst=$FULL ;; new) inst=$NEW ;; esac
  png="$OUT/vf-$2-$3-$4$([ "$1" = phone ] && echo -phone).png"
  go "$(vf_url "$inst" "$3" "$4")" "$READY"
  ab screenshot "$png" >/dev/null
  sleep 0.5
  ab screenshot "$png" >/dev/null
  read -r LAST N <<<"$(bright "$png")"
  LOD2=$(js '(() => { const p = window.__scape.prism; return `${p.lod2.tiles} ${p.buildings}`; })()')
}

ab set viewport 1400 900 >/dev/null
for f in 24 200 600 2400; do
  for o in L P; do
    vf_case desktop day "$f" "$o"
    d=$LAST
    vf_case desktop full "$f" "$o"
    n=$LAST
    read -r tiles prisms <<<"$LOD2"
    check "viewfinder $f mm $o: full-Moon buildings mid-grey, well under day" "$(ok "$tiles > 0 && $n > 0 && $n < 150 && $d > $n * 1.4")" "night $n ($N px), day $d; $tiles LoD2 tiles, $prisms prisms"
  done
done
vf_case desktop new 24 L
check "viewfinder 24 mm L: new-Moon buildings dim too" "$(ok "$LAST > 0 && $LAST < 120")" "luma $LAST ($N px)"

ab set viewport 390 844 >/dev/null
vf_case phone full 24 P
wide=$(js 'document.documentElement.scrollWidth > window.innerWidth')
check "phone 390×844 24 mm P: full-Moon buildings mid-grey, no sideways scroll" "$([ "$(ok "$LAST > 0 && $LAST < 150")" = 1 ] && [ "$wide" = false ] && echo 1 || echo 0)" "luma $LAST ($N px), overflow $wide"
ab set viewport 1400 900 >/dev/null

# Map moon shade: shade on minus shade off, per channel, over the pixels it darkens.
SHADE_READY='window.__scapeMap && window.__scape.buildings.getState().shadowMask && window.__scapeMap.getLayoutProperty("sun-shadow", "visibility") === "visible" && !window.__scape.buildings.getState().busy'
go "$BASE/?camera=51.9066,4.4880&t=$FULL&z=16.5" "$SHADE_READY"
sleep 1
ab screenshot "$OUT/map-moonshade-on.png" >/dev/null
js '(() => { window.__scapeMap.setLayoutProperty("sun-shadow", "visibility", "none"); return "ok"; })()' >/dev/null
sleep 1
ab screenshot "$OUT/map-moonshade-off.png" >/dev/null
js '(() => { window.__scapeMap.setLayoutProperty("sun-shadow", "visibility", "visible"); return "ok"; })()' >/dev/null
# Per channel, alpha = (off - on) / (off - shade); only the true shade colour gives one alpha across r, g and b.
read -r grey blue n <<<"$(uv run -q --with pillow python3 - "$OUT/map-moonshade-on.png" "$OUT/map-moonshade-off.png" <<'PY'
import sys
from PIL import Image
a, b = (Image.open(p).convert("RGB") for p in sys.argv[1:3])
px = [(pa, pb) for pa, pb in zip(a.get_flattened_data(), b.get_flattened_data()) if sum(pb) - sum(pa) > 12 and min(pb) > 90]
def spread(shade):
    s = 0
    for on, off in px:
        al = [(off[c] - on[c]) / (off[c] - shade[c]) for c in range(3)]
        s += max(al) - min(al)
    return round(s / max(1, len(px)), 3)
print(spread((17, 17, 17)), spread((8, 16, 52)), len(px))
PY
)"
check "map moon shade: neutral grey, not blue" "$(ok "$n > 500 && $grey < $blue * 0.5")" "alpha spread across r g b: $grey as grey, $blue as the old blue, over $n px"

# Map live Moon line through the lunar eclipse, from New Delhi.
moon_line() { # instant → colour of the live Moon line
  go "$BASE/?camera=28.6139,77.2090&t=$1&z=13" 'window.__scapeMap && window.__scapeMap.getSource("sky-live")'
  sleep 1.5
  js '(async () => { const d = await window.__scapeMap.getSource("sky-live").getData(); return d.features.find((f) => f.properties.body === "Moon" && f.properties.kind === "Live")?.properties.color ?? "none"; })()'
}
c=$(moon_line 2025-09-07T15:25:00Z)
ab screenshot "$OUT/map-eclipse-before.png" >/dev/null
check "map Moon line before the eclipse: blue" "$([ "$c" = "#5aa9ff" ] && echo 1 || echo 0)" "$c"
c=$(moon_line 2025-09-07T16:59:00Z)
check "map Moon line, half the disc in the umbra: between blue and copper" "$([[ $c != "#5aa9ff" && $c != "#c0582e" && $c != none ]] && echo 1 || echo 0)" "$c"
c=$(moon_line 2025-09-07T18:11:43Z)
ab screenshot "$OUT/map-eclipse-max.png" >/dev/null
check "map Moon line at totality: copper" "$([ "$c" = "#c0582e" ] && echo 1 || echo 0)" "$c"

ab set viewport 390 844 >/dev/null
c=$(moon_line 2025-09-07T18:11:43Z)
ab screenshot "$OUT/map-eclipse-max-phone.png" >/dev/null
check "phone 390×844 map Moon line at totality: copper" "$([ "$c" = "#c0582e" ] && echo 1 || echo 0)" "$c"
ab set viewport 1400 900 >/dev/null

# The Layers hint describes the grey moon shade.
js '(() => { window.__scape.ui.getState().setPanelTab("Map"); return "ok"; })()' >/dev/null
sleep 0.5
hint=$(js '[...document.querySelectorAll(".hint")].map((e) => e.textContent).find((t) => t.includes("moon")) ?? "none"')
check "Layers hint: moon shade neutral grey" "$([[ $hint == *"neutral grey"* ]] && echo 1 || echo 0)" "$hint"

rm -f "$OUT/.frame.png"
echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
