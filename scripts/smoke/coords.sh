#!/usr/bin/env bash
# Coordinates smoke: fresh profiles default to signed "lat,lng" with no space: 4 decimals in the place band and badge, 6 in the context-menu copy;
# the badge cycle still reaches DD/DM/DMS, and a stored v1 "dd" migrates to signed.
# Usage: scripts/smoke/coords.sh [port] [cdp-port] [screenshot-dir] [shot-tag]
# Needs a dev server on the port; launches a headless Brave on the CDP port unless one answers, and stops only what it started.
# With a shot tag, saves <tag>-band-desktop.png and <tag>-band-390.png of the place band.
set -uo pipefail

PORT=${1:-5471}
CDP=${2:-9471}
OUT=${3:-${TMPDIR:-/tmp}/coords}
TAG=${4:-}
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

PIN='{ lat: 44.470342, lng: -72.740381 }'
WANT='44.4703,-72.7404'
SIGNED='^-?[0-9]+\.[0-9]{6},-?[0-9]+\.[0-9]{6}$'
fresh() { # path; clears storage so the app starts as a new profile, then pins a known spot
  ab open "$BASE/$1" >/dev/null
  js '(() => { localStorage.clear(); sessionStorage.clear(); return "ok"; })()' >/dev/null
  ab open "$BASE/$1" >/dev/null
  wait_for 'window.__scape?.world' 80
  js "(() => { window.__scape.world.getState().setPin($PIN); return 'ok'; })()" >/dev/null
}
band() { # where
  wait_for '!!document.querySelector(".panel-inner")' 80
  js '(() => { document.querySelector(".panel-expand")?.click(); return "ok"; })()' >/dev/null
  wait_for '!!document.querySelector(".band .band-name")' 40
  local b
  b=$(js '(() => document.querySelector(".band .band-name")?.textContent ?? "none")()')
  check "$1: place band is lat,lng" "$([ "$b" = "$WANT" ] && echo 1 || echo 0)" "$b"
}

ab set viewport 1600 1000 >/dev/null
fresh ""
styled 120
f=$(js 'window.__scape.settings.getState().coordFormat')
check "fresh profile default format" "$([ "$f" = signed ] && echo 1 || echo 0)" "$f"
band "map band 1600"
[ -n "$TAG" ] && ab screenshot .band "$OUT/$TAG-band-desktop.png" >/dev/null

badge=$(js '(() => document.querySelector(".badges .badge")?.textContent ?? "none")()')
check "badge is lat,lng" "$([ "$badge" = "$WANT" ] && echo 1 || echo 0)" "$badge"

# Badge cycle: signed first, then DD, DM, DMS, back to signed.
seen=$(js '(() => { const b = () => document.querySelector(".badges .badge"); const out = []; return new Promise((res) => { let i = 0; const step = () => { b().click(); requestAnimationFrame(() => setTimeout(() => { out.push(`${window.__scape.settings.getState().coordFormat}=${b().textContent}`); if (++i < 4) step(); else res(out.join(" ; ")); }, 50)); }; step(); }); })()')
check "badge cycles to DD, DM, DMS, signed" "$([[ "$seen" == "dd="*"°N"*" ; dm="*"′N"*" ; dms="*"″N"*" ; signed=$WANT" ]] && echo 1 || echo 0)" "$seen"

# Context menu: the shown detail and the copied text are both lat,lng.
js '(() => { window.__copied = null; navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; document.querySelector(".maplibregl-canvas").focus(); return "ok"; })()' >/dev/null
ab press Shift+F10 >/dev/null
wait_for '!!document.querySelector(".map-menu")' 20
item=$(js '(() => { const i = [...document.querySelectorAll(".map-menu [role=menuitem]")].find((e) => /Copy coordinates/.test(e.textContent)); if (!i) return "none"; const d = i.textContent.replace("Copy coordinates", "").trim(); i.click(); return d; })()')
wait_for 'window.__copied' 20
copied=$(js 'window.__copied ?? "none"')
check "context menu shows lat,lng at 6 decimals" "$([[ "$item" =~ $SIGNED ]] && echo 1 || echo 0)" "$item"
check "context menu copies lat,lng at 6 decimals" "$([[ "$copied" =~ $SIGNED ]] && [ "$copied" = "$item" ] && echo 1 || echo 0)" "$copied"

# A v1 profile that stored the old "dd" default moves to signed once.
js '(() => { const raw = JSON.parse(localStorage.getItem("scape.settings")); raw.state.coordFormat = "dd"; raw.version = 1; localStorage.setItem("scape.settings", JSON.stringify(raw)); return "ok"; })()' >/dev/null
ab open "$BASE/" >/dev/null
wait_for 'window.__scape?.settings' 80
m=$(js '`${window.__scape.settings.getState().coordFormat} v${JSON.parse(localStorage.getItem("scape.settings")).version}`')
check "stored v1 dd migrates to signed" "$([[ "$m" == "signed v"[2-9]* ]] && echo 1 || echo 0)" "$m"

fresh viewfinder
band "viewfinder band 1600"

ab set viewport 390 844 >/dev/null
fresh ""
styled 120
band "map band 390"
[ -n "$TAG" ] && ab screenshot .band "$OUT/$TAG-band-390.png" >/dev/null

[ "$BRAVE" = 1 ] && brave_stop "$PROFILE" && rm -rf "$PROFILE"

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
