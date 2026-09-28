#!/usr/bin/env bash
# Parking links smoke: SpotHero/SpotAngels in the Timeline tab for city spots only, on desktop and a 390x844 phone.
# Usage: scripts/smoke/parklink.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port and a background Brave with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5820}
CDP=${2:-9820}
OUT=${3:-${TMPDIR:-/tmp}/parklink}
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

go() {
  local i
  for i in 1 2 3; do
    ab open "$1" >/dev/null 2>&1 && wait_for "window.__scape && ${2:-true}" 80 && return 0
    sleep 1
  done
  return 1
}

# Opens a spot, waits for the map to judge it, and prints "urban|link hrefs".
spot() { # lat,lng
  go "$BASE/?camera=$1&z=14" 'window.__scapeMap' || { echo "load failed|"; return; }
  js "window.__scape.ui.getState().setPanelTab('Timeline')" >/dev/null
  wait_for "(() => { const u = window.__scape.mapStatus.getState().urban, p = window.__scape.world.getState().pin; return u && u.p.lat === p.lat && u.p.lng === p.lng; })()" 120
  sleep 0.5
  js '(() => { const u = window.__scape.mapStatus.getState().urban; const a = [...document.querySelectorAll("[data-testid=parking] a")]; return String(u && u.urban) + "|" + a.map((e) => e.href + (e.target === "_blank" ? "" : "!self")).join(" "); })()'
}

SH_NYC='https://spothero.com/search?latitude=40.75800&longitude=-73.98550'
SA_NYC='https://www.spotangels.com/map?lat=40.75800&lng=-73.98550&zoom=16&product=parking'

ab set viewport 1400 900 >/dev/null
r=$(spot 40.758,-73.9855)
ab screenshot "$OUT/manhattan.png" >/dev/null
check "Manhattan: urban, SpotHero + SpotAngels in new tabs" "$([ "$r" = "true|$SH_NYC $SA_NYC" ] && echo 1 || echo 0)" "$r"

r=$(spot 38.40,-121.62)
ab screenshot "$OUT/rural-sacramento.png" >/dev/null
check "Sacramento delta farmland (in coverage): rural, no links" "$([ "$r" = "false|" ] && echo 1 || echo 0)" "$r"

r=$(spot 44.37,-98.85)
ab screenshot "$OUT/rural-sd.png" >/dev/null
check "rural South Dakota: no links" "$([ "${r#*|}" = "" ] && echo 1 || echo 0)" "$r"

r=$(spot 51.9225,4.4792)
ab screenshot "$OUT/rotterdam.png" >/dev/null
check "Rotterdam: urban, no coverage, no links" "$([ "$r" = "true|" ] && echo 1 || echo 0)" "$r"

ab set viewport 390 844 >/dev/null
r=$(spot 40.758,-73.9855)
ab screenshot "$OUT/phone-manhattan.png" >/dev/null
wide=$(js 'document.documentElement.scrollWidth > window.innerWidth')
vis=$(js '(() => { const e = document.querySelector("[data-testid=parking]"); if (!e) return "missing"; const b = e.getBoundingClientRect(); return b.width > 0 && b.right <= window.innerWidth ? "visible" : "clipped"; })()')
check "phone 390×844 Manhattan: links shown, no sideways scroll" "$([ "$r" = "true|$SH_NYC $SA_NYC" ] && [ "$wide" = false ] && [ "$vis" = visible ] && echo 1 || echo 0)" "$vis, overflow $wide"

ab set viewport 1400 900 >/dev/null 2>&1
echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
