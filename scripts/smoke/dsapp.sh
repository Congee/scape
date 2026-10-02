#!/usr/bin/env bash
# Design-system smoke: no old accent blue, dark click-mode, underlined calendar day, square chrome, 390 px topbar, keyboard context menu.
# Usage: scripts/smoke/dsapp.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port; launches a headless Brave on the CDP port unless one answers, and stops only what it started.
set -uo pipefail

PORT=${1:-5466}
CDP=${2:-9466}
OUT=${3:-${TMPDIR:-/tmp}/dsapp}
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
notice() { js '(() => document.querySelector(".map-notice")?.firstChild?.textContent ?? "none")()'; }

CHROME='.topbar, .topbar *, .rail, .rail *, .map-badges, .map-badges *, .map-notice, .map-notice *, .map-legend, .map-legend *, .cloud-legend, .cloud-legend *, .maplibregl-ctrl, .maplibregl-ctrl *, .map-menu, .map-menu *, .cal-pop, .cal-pop *, .page, .page *'
# Old accent and non-square corners across the chrome; dials and the FOV handle may round.
scan() {
  js "(() => { const blue = 'rgb(90, 169, 255)'; const els = [...document.querySelectorAll('$CHROME')]; const b = [], r = []; for (const e of els) { const s = getComputedStyle(e); if ([s.color, s.backgroundColor, s.borderTopColor, s.borderLeftColor, s.borderBottomColor, s.outlineColor].includes(blue) && s.display !== 'none') b.push(e.className || e.tagName); if (!e.closest('.fov-handle, .dial, .legend-wheel, .compass') && ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'].some((k) => parseFloat(s[k]) > 0)) r.push((e.className?.baseVal ?? e.className) || e.tagName); } return JSON.stringify({ n: els.length, b: [...new Set(b)].slice(0, 5), r: [...new Set(r)].slice(0, 5) }); })()"
}
scan_check() { # where
  local s n b r
  s=$(scan)
  n=$(echo "$s" | sed -E 's/.*"n":([0-9]+).*/\1/')
  b=$(echo "$s" | sed -E 's/.*"b":\[([^]]*)\].*/\1/')
  r=$(echo "$s" | sed -E 's/.*"r":\[([^]]*)\].*/\1/')
  check "$1: no old accent blue" "$([ -z "$b" ] && [ "$n" -gt 0 ] && echo 1 || echo 0)" "$n elements; ${b:-none}"
  check "$1: square chrome corners" "$([ -z "$r" ] && echo 1 || echo 0)" "${r:-none}"
}

ab set viewport 1600 1000 >/dev/null
ab open "$BASE/" >/dev/null
styled 120

# Click-mode control is dark.
bg=$(js '(() => { const e = document.querySelector(".click-mode"); return e ? getComputedStyle(e).backgroundColor : "none"; })()')
lum=$(echo "$bg" | sed -E 's/rgba?\(([0-9]+), ([0-9]+), ([0-9]+).*/\1 \2 \3/')
check "click-mode background is dark" "$(echo "$lum" | awk '{ print (NF == 3 && $1 + $2 + $3 < 150) ? 1 : 0 }')" "$bg"

# Calendar: the selected day is underlined, not filled.
js '(() => { document.querySelector(".cal-toggle").click(); return "ok"; })()' >/dev/null
wait_for '!!document.querySelector(".cal-day[aria-pressed=true]")' 40
sel=$(js '(() => { const s = getComputedStyle(document.querySelector(".cal-day[aria-pressed=true]")); return `${s.backgroundColor} | ${s.boxShadow} | ${s.fontWeight}`; })()')
check "selected day: underline, no fill" "$([[ "$sel" == "rgba(0, 0, 0, 0) |"*"inset"* && "$sel" == *"-2px"* ]] && echo 1 || echo 0)" "$sel"
scan_check "map + calendar"
ab press Escape >/dev/null
sleep 0.2
r=$(js '!!document.querySelector(".cal-pop")')
check "Esc closes the calendar" "$([ "$r" = false ] && echo 1 || echo 0)" "open: $r"

# Context menu from the keyboard.
js '(() => { document.querySelector(".maplibregl-canvas").focus(); return "ok"; })()' >/dev/null
ab press Shift+F10 >/dev/null
wait_for '!!document.querySelector(".map-menu")' 20
m=$(js '(() => { const a = document.activeElement; return `${!!document.querySelector(".map-menu")} ${a?.getAttribute("role")}`; })()')
check "Shift+F10 opens the context menu, focus on an item" "$([ "$m" = "true menuitem" ] && echo 1 || echo 0)" "$m"
scan_check "context menu"
ab press Escape >/dev/null

for p in library settings; do
  ab open "$BASE/$p" >/dev/null
  wait_for '!!document.querySelector(".page h2")' 80
  scan_check "$p"
done

# Topbar fits at phone width.
ab set viewport 390 844 >/dev/null
ab open "$BASE/" >/dev/null
styled 120
w=$(js '(() => { const t = document.querySelector(".topbar"); const d = document.documentElement; return `${t.scrollWidth} ${t.clientWidth} ${d.scrollWidth} ${d.clientWidth}`; })()')
check "topbar fits at 390 px" "$(echo "$w" | awk '{ print ($1 <= $2 && $3 <= $4) ? 1 : 0 }')" "topbar scroll/client, page scroll/client: $w"
ab screenshot "$OUT/dsapp-390.png" >/dev/null

[ "$BRAVE" = 1 ] && brave_stop "$PROFILE" && rm -rf "$PROFILE"

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
