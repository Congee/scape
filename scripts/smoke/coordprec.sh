#!/usr/bin/env bash
# Coordinate precision smoke: pasted coordinates keep their written digits, map picks get the digits one pixel resolves
# (more when zoomed in), the context-menu copy equals what it shows and what the badge shows, and an unnamed spot has no place band.
# Usage: scripts/smoke/coordprec.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port; launches a headless Brave on the CDP port unless one answers, and stops only what it started.
set -uo pipefail

PORT=${1:-5472}
CDP=${2:-9472}
OUT=${3:-${TMPDIR:-/tmp}/coordprec}
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
styled() { wait_for '(() => { const m = window.__scapeMap; return m && m.isStyleLoaded(); })()' "${1:-80}"; sleep 0.3; }
badge() { js '(() => document.querySelector(".badges .badge")?.textContent ?? "none")()'; }
decimals() { echo "$1" | awk -F, '{ n = split($1, a, "."); m = split($2, b, "."); print (n > 1 ? length(a[2]) : 0) "," (m > 1 ? length(b[2]) : 0) }'; }

paste() { # text: types it into search and goes to the first hit
  js '(() => { const i = document.querySelector(".search input"); i.focus(); i.select(); return "ok"; })()' >/dev/null
  ab fill ".search input" "$1" >/dev/null
  wait_for '!!document.querySelector(".search-results .name")' 20
  local shown
  shown=$(js '(() => document.querySelector(".search-results .name")?.textContent ?? "none")()')
  ab press Enter >/dev/null
  wait_for "document.querySelector('.badges .badge')?.textContent === '$1'" 20
  check "paste $1: result shows as written" "$([ "$shown" = "$1" ] && echo 1 || echo 0)" "$shown"
  local b
  b=$(badge)
  check "paste $1: badge shows as written" "$([ "$b" = "$1" ] && echo 1 || echo 0)" "$b"
}

ab set viewport 1600 1000 >/dev/null
ab open "$BASE/" >/dev/null
js '(() => { localStorage.clear(); sessionStorage.clear(); return "ok"; })()' >/dev/null
ab open "$BASE/" >/dev/null
wait_for 'window.__scape?.world' 80
styled 120

paste "44.470342,-72.740381"
paste "44.47,-72.74"

# Map clicks at the centre, away from the pin: zoom 16 resolves more decimals than zoom 8.
pick() { # zoom
  js "(() => { window.__scapeMap.jumpTo({ center: [-72.512345, 44.612345], zoom: $1 }); return 'ok'; })()" >/dev/null
  sleep 0.5
  ab click ".maplibregl-canvas" >/dev/null
  sleep 0.5
  badge
}
lo=$(pick 8)
hi=$(pick 16)
dlo=$(decimals "$lo")
dhi=$(decimals "$hi")
check "map pick at z8 has 3-4 decimals" "$([[ "$dlo" =~ ^[34],[34]$ ]] && echo 1 || echo 0)" "$lo ($dlo)"
check "map pick at z16 has 5-6 decimals" "$([[ "$dhi" =~ ^[56],[56]$ ]] && echo 1 || echo 0)" "$hi ($dhi)"

# Context menu at z16: Copy copies what it shows, and Camera here makes the badge show the same.
js '(() => { window.__copied = null; navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; document.querySelector(".maplibregl-canvas").focus(); return "ok"; })()' >/dev/null
menu() { ab press Shift+F10 >/dev/null; wait_for '!!document.querySelector(".map-menu")' 20; }
menu
item=$(js '(() => { const i = [...document.querySelectorAll(".map-menu [role=menuitem]")].find((e) => /Copy coordinates/.test(e.textContent)); if (!i) return "none"; const d = i.textContent.replace("Copy coordinates", "").trim(); i.click(); return d; })()')
wait_for 'window.__copied' 20
copied=$(js 'window.__copied ?? "none"')
check "copy equals the shown detail" "$([ "$copied" = "$item" ] && [ "$copied" != none ] && echo 1 || echo 0)" "$item -> $copied"
js '(() => { document.querySelector(".maplibregl-canvas").focus(); return "ok"; })()' >/dev/null
menu
js '(() => { [...document.querySelectorAll(".map-menu [role=menuitem]")].find((e) => /Camera here/.test(e.textContent))?.click(); return "ok"; })()' >/dev/null
sleep 0.3
b=$(badge)
check "copy equals the badge" "$([ "$b" = "$copied" ] && echo 1 || echo 0)" "$b"

n=$(js 'document.querySelectorAll(".band").length')
check "unnamed spot has no place band" "$([ "$n" = 0 ] && echo 1 || echo 0)" "$n bands"

[ "$BRAVE" = 1 ] && brave_stop "$PROFILE" && rm -rf "$PROFILE"

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
exit $((FAILS > 0))
