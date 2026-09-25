#!/usr/bin/env bash
# Smoke test for eye-density refraction: on Gornergrat the map's live Sun ray outlasts the sea-level threshold, as the viewfinder does.
# Usage: scripts/smoke/airdensity.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port and a browser with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5520}
CDP=${2:-9520}
OUT=${3:-${TMPDIR:-/tmp}/airdensity}
BASE="http://localhost:$PORT"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
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

go() {
  local i
  for i in 1 2 3; do
    ab open "$1" >/dev/null 2>&1 && wait_for "window.__scape && ${2:-true}" 80 && return 0
    sleep 1
  done
  return 1
}

# First instant after 19:00Z when the Sun is between the eye-density and sea-level thresholds → "ms alt riseEye riseSea".
between() { # lat lng siteM
  (cd "$ROOT" && bun -e "import { makeObserver, SkyBody } from './src/lib/core/astro/bodies'; import { position } from './src/lib/core/astro/positions'; import { airDensity, riseApparentDeg } from './src/lib/core/astro/refraction'; const o = makeObserver({ lat: $1, lng: $2 }, $3); const eye = riseApparentDeg(airDensity($3)), sea = riseApparentDeg(1); let t = Date.parse('2026-06-21T19:00:00Z'); while (position(SkyBody.Sun, new Date(t), o).altitude > (eye + sea) / 2) t += 1000; console.log(t, position(SkyBody.Sun, new Date(t), o).altitude.toFixed(4), eye.toFixed(4), sea.toFixed(4));")
}
sun_ray() { # ms → yes/no
  js "(() => { window.__scape.world.getState().setTime($1); return 'ok'; })()" >/dev/null
  sleep 1
  js '(async () => { const d = await window.__scapeMap.getSource("sky-live").getData(); return d.features.some((f) => f.properties.body === "Sun" && f.properties.kind === "Live") ? "yes" : "no"; })()'
}

ab set viewport 1400 900 >/dev/null
HIGH="45.9837,7.7847"
go "$BASE/?camera=$HIGH&t=2026-06-21T19:00Z&tz=Europe/Zurich&z=13" 'window.__scapeMap && window.__scapeMap.getSource("sky-live")'
wait_for 'window.__scape.terrain.getState().pinGroundM > 2500' 120
site=$(js '(() => { const g = window.__scape.terrain.getState().pinGroundM; return g + window.__scape.world.getState().pinHeightM + 1.6; })()')
read -r ms alt eye sea <<<"$(between "${HIGH%,*}" "${HIGH#*,}" "$site")"
r=$(sun_ray "$ms")
ab screenshot "$OUT/map-gornergrat.png" >/dev/null
check "Gornergrat ${site%.*} m: Sun ray at ${alt}° (under sea-level ${sea}°, over eye ${eye}°)" "$([ "$r" = yes ] && echo 1 || echo 0)" "live Sun ray: $r"
r=$(sun_ray $((ms + 60000)))
check "Gornergrat: Sun ray gone a minute later" "$([ "$r" = no ] && echo 1 || echo 0)" "live Sun ray: $r"
errs=$(js '(() => { const t = document.body.innerText; return /NaN|undefined/.test(t) ? "yes" : "no"; })()')
check "desktop map: no NaN/undefined in the UI" "$([ "$errs" = no ] && echo 1 || echo 0)" "$errs"

ab set viewport 390 844 >/dev/null
go "$BASE/?camera=$HIGH&t=2026-06-21T19:20Z&tz=Europe/Zurich&z=13" 'window.__scapeMap && window.__scapeMap.getSource("sky-live")'
sleep 1.5
ab screenshot "$OUT/phone-map.png" >/dev/null
wide=$(js 'document.documentElement.scrollWidth > window.innerWidth')
check "phone 390×844 map: no sideways page scroll" "$([ "$wide" = false ] && echo 1 || echo 0)" "overflow $wide"

ab set viewport 1400 900 >/dev/null 2>&1
echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
