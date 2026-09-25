#!/usr/bin/env bash
# Smoke test that the live DateBar time shows minutes without ticking seconds, and that the panels follow a time change, on desktop and phone.
# Usage: scripts/smoke/clock-ticks.sh [port] [cdp-port] [screenshot-dir]
# Needs a server (dev or probe build) on the port and a browser with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5173}
CDP=${2:-9222}
OUT=${3:-${TMPDIR:-/tmp}/clock-ticks}
BASE="http://localhost:$PORT"
mkdir -p "$OUT"

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

go() {
  local i
  for i in 1 2 3; do
    ab open "$1" >/dev/null 2>&1 && wait_for 'window.__scape && document.querySelector(".datebar input[type=time]")' && return 0
    sleep 1
  done
  return 1
}

hm() { js 'document.querySelector(".datebar input[type=time]")?.value ?? ""'; }
active() { js 'document.querySelector(".timeline li.active .label")?.textContent + " " + document.querySelector(".timeline li.active .time")?.textContent'; }
readout() { js 'document.querySelector(".readout")?.textContent ?? "none"'; }
# A fixed zone, so the expected wall time is known.
set_time() { js "(() => { const w = window.__scape.world.getState(); w.setTz('UTC'); w.setTime(Date.parse('$1')); return 'ok'; })()" >/dev/null; }

colons() { local x=${1//[^:]/}; echo ${#x}; }

pass() { # viewport label, width, height
  local tag=$1
  ab set viewport "$2" "$3" >/dev/null
  go "$BASE/" || { check "$tag load" 0 "no DateBar"; return; }
  js '(() => { window.__scape.world.getState().setNow(); return "ok"; })()' >/dev/null

  # Away from the Timeline, live time moves only on the minute.
  js '(() => { const u = window.__scape.ui.getState(); u.setPanelTab("Geodetics"); document.activeElement?.blur(); return "ok"; })()' >/dev/null
  ab mouse move 1 1 >/dev/null
  sleep 0.3
  local c0 c1 t0 t1
  c0=$(hm)
  t0=$(js 'window.__scape.world.getState().time')
  sleep 2.2
  c1=$(hm)
  t1=$(js 'window.__scape.world.getState().time')
  check "$tag live clock shows minutes" "$([ "$(colons "$c0")" = 1 ] && echo 1 || echo 0)" "$c0"
  check "$tag no tick within the minute" "$([ "$t0" = "$t1" ] || [ "$c0" != "$c1" ] && echo 1 || echo 0)" "time $([ "$t0" = "$t1" ] && echo held || echo 'rolled over')"
  ab screenshot "$OUT/$tag-live-minutes.png" >/dev/null

  js '(() => { const u = window.__scape.ui.getState(); u.setPanelTab("Timeline"); u.setPanelCollapsed(false); return "ok"; })()' >/dev/null
  sleep 0.3
  c0=$(hm)
  check "$tag Timeline tab shows minutes" "$([ "$(colons "$c0")" = 1 ] && echo 1 || echo 0)" "$c0"
  ab screenshot "$OUT/$tag-live-timeline.png" >/dev/null

  set_time 2026-06-21T06:30:00Z
  sleep 0.3
  local h1 a1 r1 live1
  h1=$(hm)
  a1=$(active)
  r1=$(readout)
  live1=$(js 'document.querySelector(".datebar input[type=time]")?.classList.contains("live")')
  check "$tag set time: hm" "$([ "$h1" = 06:30 ] && echo 1 || echo 0)" "$h1"
  check "$tag set time: not live" "$([ "$live1" = false ] && echo 1 || echo 0)" "live=$live1"
  ab screenshot "$OUT/$tag-0630.png" >/dev/null

  set_time 2026-06-21T18:45:00Z
  sleep 0.3
  local h2 a2 r2
  h2=$(hm)
  a2=$(active)
  r2=$(readout)
  check "$tag second time: hm" "$([ "$h2" = 18:45 ] && echo 1 || echo 0)" "$h2"
  check "$tag timeline active row moves" "$([ "$a1" != "$a2" ] && echo 1 || echo 0)" "$a1 → $a2"
  check "$tag readout follows" "$([ "$r1" = none ] || [ "$r1" != "$r2" ] && echo 1 || echo 0)" "$([ "$r1" = none ] && echo 'not shown' || echo changed)"
  ab screenshot "$OUT/$tag-1845.png" >/dev/null
}

pass desktop 1400 900
pass phone 390 844

js '(() => { const w = window.__scape.world.getState(); w.setTz(null); w.setNow(); return "ok"; })()' >/dev/null 2>&1
ab set viewport 1400 900 >/dev/null 2>&1

echo "| check | result | detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "screenshots: $OUT"
exit $((FAILS > 0))
