#!/usr/bin/env bash
# Tides smoke: the Timeline tide row and Tools tides group for a harmonic station, a closer subordinate one beating a harmonic one, a subordinate-only site and an inland pin, desktop and phone.
# Usage: scripts/smoke/tides.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port and a background browser with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5438}
CDP=${2:-9438}
OUT=${3:-${TMPDIR:-/tmp}/tides}
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

DAY="2026-10-18T15:00Z"
# The Battery (harmonic 8518750); Kamalo Harbor on Molokai, 78 m from subordinate 1613077 but 17 km from harmonic Kaunakakai 1613198;
# Hana on Maui (subordinate 1615395, no harmonic station within 50 km); Denver (no station).
HARMONIC="40.7003,-74.0150"
CLOSER_SUB="21.0490,-156.8770"
SUBORDINATE="20.7617,-155.9870"
INLAND="39.7392,-104.9903"

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
    ab open "$1" >/dev/null 2>&1 && wait_for 'window.__scape && document.querySelector(".tabs button")' && return 0
    sleep 1
  done
  return 1
}

quiet() { # fewest rAF/timers over up to three 3 s windows, so late tile loads do not count
  local best="" i n
  for i in 1 2 3; do
    js '(() => { window.__scape.idle.reset(); return "ok"; })()' >/dev/null
    sleep 3
    n=$(js '(() => { const p = window.__scape.idle; return `${p.raf} ${p.timers}`; })()')
    if [ -z "$best" ] || [ "${n% *}" -lt "${best% *}" ]; then best=$n; fi
    [ "${best% *}" = 0 ] && break
  done
  echo "$best"
}

tab() { js "(() => { const u = window.__scape.ui.getState(); u.setPanelTab('$1'); u.setPanelCollapsed(false); return 'ok'; })()" >/dev/null; }

# Timeline row: "kind|marks|curve|label|time|extra" or "none"; curve is 1 solid, 2 dashed (interpolated).
row() { js '(() => { const r = document.querySelector(".timeline .tide-row"); if (!r) return "none"; const t = (s) => r.querySelector(s)?.textContent ?? ""; return [/subordinate to /.test(t(".extra")) ? "subordinate" : /harmonic/.test(t(".extra")) ? "harmonic" : "?", r.querySelectorAll("circle.high, circle.low").length, r.querySelectorAll("polyline").length + r.querySelectorAll("polyline.interpolated").length, t(".label"), t(".time"), t(".extra")].join("|"); })()'; }

tools() { # summary|station line
  tab Tools
  sleep 0.3
  js '(() => { const d = [...document.querySelectorAll(".tools details")].find((g) => g.querySelector("summary").textContent.startsWith("Tides")); if (!d) return "missing"; d.open = true; d.scrollIntoView(); const v = d.querySelector(".kv .v"); return `${d.querySelector("summary").textContent}|${v ? v.textContent : ""}`; })()'
}

site() { # tag, camera, expected kind, viewport tag, [expected station name], [min marks], [expected reference name]
  go "$BASE/?camera=$2&t=$DAY"
  tab Timeline
  if [ "$3" = none ]; then
    sleep 3
    local r; r=$(row)
    check "$4 $1: no tide row" "$([ "$r" = none ] && echo 1 || echo 0)" "$r"
  else
    wait_for 'document.querySelector(".timeline .tide-row")' 60
    sleep 0.3
    local r; r=$(row)
    IFS='|' read -r kind marks lines label time extra <<<"$r"
    local want=1; [ "$3" = subordinate ] && want=2
    check "$4 $1: tide row, $3" "$([ "$kind" = "$3" ] && [ "$marks" -ge "${6:-3}" ] && [ "$marks" -le 5 ] && [ "$lines" = "$want" ] && echo 1 || echo 0)" "$label $time · $extra · $marks marks, curve $lines"
    local t0; t0=$(js 'window.__scape.world.getState().time')
    # Press by coordinates: marks scrub on pointerdown, and the dot covers the hit ring.
    local xy; xy=$(js '(() => { const c = document.querySelector(".timeline .tide-row circle.hit"); c.scrollIntoView({ block: "center" }); const r = c.getBoundingClientRect(); return `${Math.round(r.left + r.width / 2)} ${Math.round(r.top + r.height / 2)}`; })()')
    ab mouse move ${xy% *} ${xy#* } >/dev/null
    ab mouse down >/dev/null
    ab mouse up >/dev/null
    sleep 0.2
    local t1; t1=$(js 'window.__scape.world.getState().time')
    check "$4 $1: a high/low mark sets the clock" "$([ "$t0" != "$t1" ] && echo 1 || echo 0)" "$(date -u -r $((t1 / 1000)) +%H:%MZ)"
    js "(() => { window.__scape.world.getState().setTime(Date.parse('$DAY')); return 'ok'; })()" >/dev/null
    IDLE_ROW=$(quiet)
  fi
  ab screenshot "$OUT/$4-$1-timeline.png" >/dev/null
  local t; t=$(tools)
  if [ "$3" = none ]; then
    check "$4 $1: Tools says no station" "$([[ $t == *"no station within"* ]] && echo 1 || echo 0)" "${t%%|*}"
  else
    local kind=$3; [ "$3" = subordinate ] && kind="subordinate to ${7:?}"
    check "$4 $1: Tools names the $kind station${5:+ $5} and distance" "$([[ $t == *"${5:-}"*"$kind"*away* ]] && echo 1 || echo 0)" "${t#*|}"
  fi
  sleep 0.3
  ab screenshot "$OUT/$4-$1-tools.png" >/dev/null
  local wide; wide=$(js 'document.documentElement.scrollWidth > window.innerWidth')
  check "$4 $1: no sideways page scroll" "$([ "$wide" = false ] && echo 1 || echo 0)" "overflow $wide"
}

idle_case() { # viewport tag: idle rAF/timers with the row vs. inland without it
  local with="$IDLE_ROW"
  go "$BASE/?camera=$INLAND&t=$DAY"
  tab Timeline
  sleep 1
  local without; without=$(quiet)
  read -r r1 t1 <<<"$with"
  read -r r0 t0 <<<"$without"
  check "$1 idle 3 s: subordinate tide row adds no frames or timers" "$([ "$r1" -le "$r0" ] && [ "$t1" -le "$t0" ] && echo 1 || echo 0)" "rAF/timers $with with the row, $without without"
  check "$1 idle 3 s: no frames with the subordinate row" "$([ "$r1" = 0 ] && echo 1 || echo 0)" "rAF $r1"
}

IDLE_ROW="0 0"
for vp in desktop phone; do
  if [ $vp = desktop ]; then ab set viewport 1400 900 >/dev/null; else ab set viewport 390 844 >/dev/null; fi
  site harmonic "$HARMONIC" harmonic $vp
  site closer-subordinate "$CLOSER_SUB" subordinate $vp Kamalo 1 HONOLULU
  site subordinate "$SUBORDINATE" subordinate $vp Hana 1 KAHULUI
  idle_case $vp
  site inland "$INLAND" none $vp
done
ab set viewport 1400 900 >/dev/null

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
