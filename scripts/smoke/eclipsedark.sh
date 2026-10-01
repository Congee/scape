#!/usr/bin/env bash
# Smoke for the eclipse-aware Night tab: the moon-free window opens for the 2025-09-07 totality from New Delhi,
# a plain full-moon night has none, and the Milky Way Dim rule passes in Nairobi during totality; desktop and a 390x844 phone.
# Usage: scripts/smoke/eclipsedark.sh [port] [cdp-port] [screenshot-dir]
set -uo pipefail

PORT=${1:-5720}
CDP=${2:-9720}
OUT=${3:-${TMPDIR:-/tmp}/eclipsedark}
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

wait_for() { # js condition, tries of 0.25 s
  local i
  for ((i = 0; i < ${2:-80}; i++)); do
    [ "$(js "!!($1)")" = true ] && return 0
    sleep 0.25
  done
  return 1
}

# Night tab open with the Moon and Milky Way groups expanded.
night() { # camera, instant, moon rule
  local i
  for i in 1 2 3; do
    ab open "$BASE/?camera=$1&t=$2" >/dev/null 2>&1 && wait_for 'window.__scape && document.querySelector(".tabs button")' && break
    sleep 1
  done
  js "(() => { const s = window.__scape; s.settings.getState().update({ mwMoonRule: '$3' }); s.ui.getState().setPanelTab('Sky'); s.ui.setState({ panelCollapsed: false }); return 'ok'; })()" >/dev/null
  wait_for 'document.querySelector(".frame.night details")'
  js '(() => { const ds = document.querySelectorAll(".frame.night > details"); ds[1].open = true; ds[1].scrollIntoView({ block: "start" }); return "ok"; })()' >/dev/null
  sleep 0.5
}

FREE='(() => { const k = [...document.querySelectorAll(".frame.night .k")].find((e) => e.textContent === "Moon-free dark"); return k ? k.nextElementSibling.textContent.replace(/\s+/g, " ").trim() : "missing"; })()'
VERDICT='document.querySelector(".frame.night .verdict")?.textContent.trim() ?? "missing"'
NOSIDE='document.documentElement.scrollWidth <= innerWidth'

run() { # label
  local tag=$1 txt
  night "28.6,77.2" "2025-09-07T15:00:00Z" Down
  txt=$(js "$FREE")
  check "$tag Delhi 2025-09-07: window is the totality" "$([[ $txt == *"1 h 22 min"* && $txt == *"eclipsed Moon"* ]] && echo 1 || echo 0)" "$txt"
  check "$tag no sideways scroll" "$([ "$(js "$NOSIDE")" = true ] && echo 1 || echo 0)" "scrollWidth $(js 'document.documentElement.scrollWidth') / $(js 'innerWidth')"
  ab screenshot "$OUT/$tag-delhi-eclipse.png" >/dev/null

  night "28.6,77.2" "2025-10-07T15:00:00Z" Down
  txt=$(js "$FREE")
  check "$tag Delhi 2025-10-07 full moon: no window" "$([[ $txt == *"moon up all night"* && $txt != *eclipsed* ]] && echo 1 || echo 0)" "$txt"
  ab screenshot "$OUT/$tag-delhi-fullmoon.png" >/dev/null

  night "-1.29,36.82" "2025-09-07T18:11:43Z" Dim
  js '(() => { const d = document.querySelector(".frame.night .verdict").closest("details"); d.open = true; d.scrollIntoView({ block: "start" }); return "ok"; })()' >/dev/null
  sleep 0.5
  txt=$(js "$VERDICT")
  check "$tag Nairobi mid-totality, Dim: core visible" "$([[ $txt == "Core visible now"* ]] && echo 1 || echo 0)" "$txt"
  ab screenshot "$OUT/$tag-nairobi-totality.png" >/dev/null

  night "-1.29,36.82" "2025-09-07T20:30:00Z" Dim
  txt=$(js "$VERDICT")
  check "$tag Nairobi after the eclipse, Dim: moon too bright" "$([[ $txt == "Core not visible now"* && $txt == *"moon up"* && $txt != *"core needs"* ]] && echo 1 || echo 0)" "$txt"
}

ab set viewport 1400 900 >/dev/null
run desktop
ab set viewport 390 844 >/dev/null
run phone
ab set viewport 1400 900 >/dev/null

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
