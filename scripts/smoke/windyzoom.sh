#!/usr/bin/env bash
# Windy link smoke: the map-layer card's Windy link carries the map centre at MapLibre zoom + 1, without the forecast pin below Windy zoom 8, on desktop and phone.
# Usage: scripts/smoke/windyzoom.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port; launches a headless Brave on the CDP port unless one answers, and stops only what it started. Never opens windy.com.
set -uo pipefail

PORT=${1:-5472}
CDP=${2:-9472}
OUT=${3:-${TMPDIR:-/tmp}/windyzoom}
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

LINK='document.querySelector("[data-card=map-layer] a.wx-windy")'
case_() { # viewport, lat,lng, zoom, expected href
  ab open "$BASE/?camera=$2&z=$3" >/dev/null 2>&1
  wait_for 'window.__scape && window.__scapeMap' 80
  js '(() => { const u = window.__scape.ui.getState(); u.setPanelTab("Weather"); u.setPanelCollapsed(false); window.__scape.weather.getState().setLayer("Total"); return "ok"; })()' >/dev/null
  wait_for "$LINK" 20
  local href
  href=$(js "(() => { const a = $LINK; return a ? a.href : 'none'; })()")
  check "$1 $2 z$3" "$([ "$href" = "$4" ] && echo 1 || echo 0)" "$href"
  ab screenshot "$OUT/$1-$3.png" >/dev/null
}

for v in desktop phone; do
  if [ $v = desktop ]; then ab set viewport 1400 900 >/dev/null; else ab set viewport 390 844 >/dev/null; fi
  case_ $v 51.9225,4.4792 5 'https://www.windy.com/?clouds,51.9225,4.4792,6'
  case_ $v 39.7392,-104.9903 8 'https://www.windy.com/39.7392/-104.9903?clouds,39.7392,-104.9903,9'
  case_ $v 45.9763,7.6586 14 'https://www.windy.com/45.9763/7.6586?clouds,45.9763,7.6586,15'
done

js '(() => { window.__scape.weather.getState().setLayer("Off"); return "ok"; })()' >/dev/null
ab set viewport 1400 900 >/dev/null
[ "$BRAVE" = 1 ] && brave_stop "$PROFILE" && rm -rf "$PROFILE"

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
