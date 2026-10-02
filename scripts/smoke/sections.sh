#!/usr/bin/env bash
# Panel sections smoke: every tab of the map and viewfinder panels, desktop and 390 px. Section heads in fg, field labels in fg-2,
# a 1px line rule on every section after the first, no section inside a section, and Frame's Aim and Depth of field as their own sections.
# Usage: scripts/smoke/sections.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port; launches a headless Brave on the CDP port unless one answers, and stops only what it started.
set -uo pipefail

PORT=${1:-5470}
CDP=${2:-9470}
OUT=${3:-${TMPDIR:-/tmp}/sections}
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

# fg, fg-2 and line from the design tokens.
FG='rgb(241, 241, 241)'
FG2='rgb(171, 171, 171)'
LINE='rgb(54, 54, 54)'
# Prints "<sections> <bad heads> <bad labels> <bad rules> <nested>" for the open tab.
SCAN="(() => { const b = document.querySelector('.tab-body'); const ss = [...b.querySelectorAll('.psec')]; const hs = [...b.querySelectorAll('.psec-h')]; const ls = [...b.querySelectorAll('.kv > .k, .vrow-k, .field > span:first-child')].filter((e) => e.getClientRects().length); const bh = hs.filter((h) => getComputedStyle(h).color !== '$FG').map((h) => h.textContent); const bl = ls.filter((l) => getComputedStyle(l).color !== '$FG2').map((l) => l.textContent); const br = ss.filter((s, i) => { const c = getComputedStyle(s); const first = !s.previousElementSibling?.classList.contains('psec'); return first ? parseFloat(c.borderTopWidth) !== 0 : c.borderTopWidth !== '1px' || c.borderTopStyle !== 'solid' || c.borderTopColor !== '$LINE'; }).map((s) => s.querySelector('.psec-h')?.textContent ?? '(untitled)'); const n = ss.filter((s) => s.parentElement.closest('.psec')).length; return [ss.length, ls.length, JSON.stringify(bh), JSON.stringify(bl.slice(0, 3)), JSON.stringify(br), n].join(' '); })()"

scan_tabs() { # where
  local tabs t r n l bh bl br nest
  tabs=$(js '[...document.querySelectorAll(".tablist [role=tab]")].map((t) => t.id.slice(5)).join(" ")')
  for t in $tabs; do
    js "(() => { document.getElementById('ptab-$t').click(); return 'ok'; })()" >/dev/null
    wait_for "document.getElementById('ptab-$t').getAttribute('aria-selected') === 'true' && !!document.querySelector('.tab-body .psec')" 40
    sleep 0.3
    read -r n l bh bl br nest <<<"$(js "$SCAN")"
    check "$1 $t: section heads fg" "$([ "${n:-0}" -gt 0 ] && [ "$bh" = '[]' ] && echo 1 || echo 0)" "$n sections; off: $bh"
    check "$1 $t: field labels fg-2" "$([ "$bl" = '[]' ] && echo 1 || echo 0)" "$l labels; off: $bl"
    check "$1 $t: 1px line rule after the first, none on it; not nested" "$([ "$br" = '[]' ] && [ "$nest" = 0 ] && echo 1 || echo 0)" "off: $br; nested: $nest"
  done
}

open_panel() { # path
  ab open "$BASE$1" >/dev/null
  wait_for '!!document.querySelector(".panel-inner .tablist")' 80
  js '(() => { document.querySelector(".panel-expand")?.click(); return "ok"; })()' >/dev/null
}

for vp in "desktop 1600 1000" "390 390 844"; do
  read -r name w h <<<"$vp"
  ab set viewport "$w" "$h" >/dev/null
  open_panel /
  scan_tabs "map $name"
  # The reported case: Aim and Depth of field are separate, ruled sections.
  js '(() => { document.getElementById("ptab-Frame").click(); return "ok"; })()' >/dev/null
  wait_for '!!document.querySelector(".tab-body .psec-h")' 40
  f=$(js '(() => { const hs = [...document.querySelectorAll(".tab-body .psec-h")]; const s = (t) => hs.find((h) => h.textContent === t)?.closest(".psec"); const a = s("Aim"), d = s("Depth of field"); return `${!!a && !!d && a !== d} ${d ? getComputedStyle(d).borderTopWidth : "none"} ${hs.map((h) => h.textContent).join(",")}`; })()')
  check "map $name Frame: Aim and Depth of field are ruled sections" "$([[ "$f" == "true 1px "* ]] && echo 1 || echo 0)" "$f"
  ab screenshot "$OUT/sections-frame-$name.png" >/dev/null
  open_panel /viewfinder
  scan_tabs "viewfinder $name"
  ab screenshot "$OUT/sections-viewfinder-$name.png" >/dev/null
done

[ "$BRAVE" = 1 ] && brave_stop "$PROFILE" && rm -rf "$PROFILE"

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
