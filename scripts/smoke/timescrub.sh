#!/usr/bin/env bash
# Smoke test: the DateBar shows one clock; the charts show ew-resize only on the time line or mid-drag; dragging or arrow keys on the Timeline tide curve and cloud strip, the Tools tide curve and the Night moon chart move the clock and the cursor, desktop and phone; on touch a vertical swipe leaves the time.
# Usage: scripts/smoke/timescrub.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port and a background browser with remote debugging on the CDP port; the cloud strip needs Open-Meteo.
set -uo pipefail

PORT=${1:-5451}
CDP=${2:-9451}
OUT=${3:-${TMPDIR:-/tmp}/timescrub}
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
    ab open "$1" >/dev/null 2>&1 && wait_for 'window.__scape && document.querySelector(".datebar")' && return 0
    sleep 1
  done
  return 1
}

# The Battery, NYC: a harmonic tide curve. Tomorrow at 15:00Z, inside the forecast horizon.
CAMERA="40.7003,-74.0150"
DAY="$(date -u -v+1d +%Y-%m-%d 2>/dev/null || date -u -d tomorrow +%Y-%m-%d)T15:00Z"

tab() { js "(() => { const u = window.__scape.ui.getState(); u.setPanelTab('$1'); u.setPanelCollapsed(false); return 'ok'; })()" >/dev/null; }
hm() { js 'document.querySelector(".datebar input[type=time]")?.value ?? ""'; }
now_x() { js "(() => { const l = document.querySelector('$1 .scrub-cursor .now'); return l ? Math.round(l.getBoundingClientRect().left) : -1; })()"; }
# Visible time readouts in the bar: the time input plus anything else showing h:mm.
clocks() { js '(() => { const b = document.querySelector(".datebar"); const extra = [...b.querySelectorAll("span, output, time, b")].filter((e) => e.offsetParent && /\d:\d\d/.test(e.textContent)); return `${b.querySelectorAll("input[type=time]").length} ${extra.length}`; })()'; }

GEOM=""
press() { # selector, fraction: scroll the chart into view and press at that fraction of its width
  GEOM=$(js "(() => { const s = document.querySelector('$1'); s.scrollIntoView({ block: 'center' }); const r = s.getBoundingClientRect(); return [r.left, r.width, r.top + r.height / 2].map(Math.round).join(' '); })()")
  ab mouse move "$(at "$2")" "${GEOM##* }" >/dev/null
  ab mouse down >/dev/null
}
at() { local left width mid; read -r left width mid <<<"$GEOM"; echo $((left + width * $1 / 100)); }
drag_to() { # fraction, in four moves from the last one
  local from=$DRAG_AT i
  for i in 1 2 3 4; do ab mouse move $((from + ($(at "$1") - from) * i / 4)) "${GEOM##* }" >/dev/null; done
  DRAG_AT=$(at "$1")
}
release() { ab mouse up >/dev/null; }

cursor_at() { # x, y: the computed cursor of what is under the pointer there
  ab mouse move "$1" "$2" >/dev/null
  js "(() => { const e = document.elementFromPoint($1, $2); return e ? getComputedStyle(e).cursor : 'none'; })()"
}

hover_cursor() { # tag, selector, label: ew-resize on the time line, default 40 px off it
  local sel=$2 lx y on off side
  lx=$(js "(() => { const r = document.querySelector('$sel .scrub-cursor .now').getBoundingClientRect(); return Math.round(r.left + r.width / 2); })()")
  y=${GEOM##* }
  on=$(cursor_at "$lx" "$y")
  check "$1 $3: ew-resize on the line" "$([ "$on" = ew-resize ] && echo 1 || echo 0)" "x=$lx: $on"
  side=$((lx - 40)); [ "$side" -lt "$(at 2)" ] && side=$((lx + 40))
  off=$(cursor_at "$side" "$y")
  check "$1 $3: default cursor 40 px off the line" "$([ "$off" = default ] && echo 1 || echo 0)" "x=$side: $off"
}

scrub() { # tag, selector, label, [press, mid, end fractions]
  local f0=${4:-20} f1=${5:-30} f2=${6:-70}
  local sel=$2 hd xd h1 x1 cur
  wait_for "document.querySelector('$sel')" 60 || { check "$1 $3: chart shown" 0 missing; return; }
  press "$sel" "$f0"
  DRAG_AT=$(at "$f0")
  drag_to "$f1"
  hd=$(hm); xd=$(now_x "$sel")
  # Mid-drag, 40 px below the chart: the captured drag keeps the resize cursor.
  local below; below=$(js "Math.round(document.querySelector('$sel').getBoundingClientRect().bottom + 40)")
  ab mouse move "$DRAG_AT" "$below" >/dev/null
  cur=$(js "(() => { const s = document.querySelector('$sel'); return getComputedStyle(s).cursor + (s.contains(document.elementFromPoint($DRAG_AT, $below)) ? ' inside' : ' off-chart'); })()")
  check "$1 $3: drag off the chart keeps ew-resize" "$([ "$cur" = 'ew-resize off-chart' ] && echo 1 || echo 0)" "$cur"
  ab mouse move "$DRAG_AT" "${GEOM##* }" >/dev/null
  drag_to "$f2"
  h1=$(hm); x1=$(now_x "$sel")
  release
  check "$1 $3: press sets the time" "$([ -n "$hd" ] && [ "$xd" -ge 0 ] && echo 1 || echo 0)" "$hd at x=$xd"
  check "$1 $3: drag moves the clock and cursor" "$([ "$hd" != "$h1" ] && [ "$x1" -gt "$xd" ] && echo 1 || echo 0)" "$hd → $h1, x $xd → $x1"
  ab screenshot "$OUT/$1-$3.png" >/dev/null
  hover_cursor "$1" "$sel" "$3"
  # Keys: the press focused the chart.
  local focused k0 k1 k2
  focused=$(js "document.activeElement === document.querySelector('$sel')")
  k0=$(js 'window.__scape.world.getState().time')
  ab press ArrowRight >/dev/null
  k1=$(js 'window.__scape.world.getState().time')
  ab press Shift+ArrowLeft >/dev/null
  k2=$(js 'window.__scape.world.getState().time')
  check "$1 $3: arrow +1 h, Shift+arrow −10 min" "$([ "$focused" = true ] && [ $((k1 - k0)) = 3600000 ] && [ $((k2 - k1)) = -600000 ] && echo 1 || echo 0)" "focused=$focused, $(((k1 - k0) / 60000)) min, $(((k2 - k1) / 60000)) min"
}

pass() { # tag, width, height
  local tag=$1
  ab set viewport "$2" "$3" >/dev/null
  go "$BASE/?camera=$CAMERA&t=$DAY" || { check "$tag load" 0 "no DateBar"; return; }
  js '(() => { window.__scape.world.getState().setNow(); return "ok"; })()' >/dev/null
  sleep 0.3
  local c live now
  c=$(clocks)
  live=$(js 'document.querySelector(".datebar input[type=time]").classList.contains("live")')
  now=$(js '[...document.querySelectorAll(".datebar button")].find((b) => b.textContent.trim() === "Now")?.getAttribute("aria-pressed")')
  check "$tag one clock in the date bar" "$([ "$c" = "1 0" ] && echo 1 || echo 0)" "time inputs, other clocks: $c"
  check "$tag live shown on the input and Now" "$([ "$live" = true ] && [ "$now" = true ] && echo 1 || echo 0)" "input live=$live, Now pressed=$now"
  ab screenshot "$OUT/$tag-datebar-live.png" >/dev/null
  js "(() => { window.__scape.world.getState().setTime(Date.parse('$DAY')); return 'ok'; })()" >/dev/null
  sleep 0.2
  now=$(js '[...document.querySelectorAll(".datebar button")].find((b) => b.textContent.trim() === "Now")?.getAttribute("aria-pressed")')
  check "$tag set time releases Now" "$([ "$now" = false ] && echo 1 || echo 0)" "Now pressed=$now"

  tab Timeline
  scrub "$tag" ".timeline .tide-row .tide-curve" "timeline tide"
  # A press on a high/low mark snaps to it.
  local mark t
  mark=$(js 'document.querySelector(".timeline .tide-row [data-t]")?.dataset.t ?? ""')
  # The visible dot covers the hit ring's centre, so press by coordinates.
  local xy; xy=$(js '(() => { const r = document.querySelector(".timeline .tide-row [data-t] circle.hit").getBoundingClientRect(); return `${Math.round(r.left + r.width / 2)} ${Math.round(r.top + r.height / 2)}`; })()')
  ab mouse move ${xy% *} ${xy#* } >/dev/null
  ab mouse down >/dev/null
  ab mouse up >/dev/null
  t=$(js 'window.__scape.world.getState().time')
  check "$tag tide mark snaps to its time" "$([ -n "$mark" ] && [ "$t" = "$mark" ] && echo 1 || echo 0)" "$(date -u -r $((t / 1000)) +%H:%MZ)"
  scrub "$tag" ".timeline .cloud-row .cloud-chart" "timeline cloud"
  tab Tools
  js '(() => { const d = [...document.querySelectorAll(".tools details")].find((g) => g.querySelector("summary").textContent.startsWith("Tides")); if (d) d.open = true; return "ok"; })()' >/dev/null
  scrub "$tag" ".tools .tide-curve" "tools tide"

  local wide; wide=$(js 'document.documentElement.scrollWidth > window.innerWidth')
  check "$tag no sideways page scroll" "$([ "$wide" = false ] && echo 1 || echo 0)" "overflow $wide"
}

night() { # tag, width, height: Night moon chart; needs a moonlit night toward the aim
  local tag=$1
  ab set viewport "$2" "$3" >/dev/null
  go "$BASE/?camera=$CAMERA&t=$DAY" || return
  tab Night
  js '(() => { document.querySelectorAll(".night details").forEach((d) => (d.open = true)); return "ok"; })()' >/dev/null
  if wait_for 'document.querySelector(".night .moon-chart svg")' 20; then
    scrub "$tag" ".night .moon-chart svg" "night moon" 5 10 25
    # Past midnight the chart keeps the same night.
    local s0 s1 x
    s0=$(js 'document.querySelector(".night .moon-chart svg").getAttribute("aria-label") + document.querySelector(".night .moon-chart polyline")?.getAttribute("points")')
    press ".night .moon-chart svg" 40
    DRAG_AT=$(at 40)
    drag_to 90
    s1=$(js 'document.querySelector(".night .moon-chart svg").getAttribute("aria-label") + document.querySelector(".night .moon-chart polyline")?.getAttribute("points")')
    x=$(now_x ".night .moon-chart svg")
    release
    check "$tag night moon: drag past midnight keeps the night" "$([ "$s0" = "$s1" ] && [ "$x" -ge "$(at 85)" ] && echo 1 || echo 0)" "$(hm), cursor x $x"
    ab screenshot "$OUT/$tag-night-moon-after-midnight.png" >/dev/null
  else
    check "$tag night moon: chart shown" 1 "no moon chart that night (skipped)"
  fi
}

pass desktop 1400 900
night desktop 1400 900
night phone 390 844
pass phone 390 844
TOUCH=$(DAY=$DAY bun "$(dirname "$0")/timescrub-touch.ts" "$CDP" "$PORT" phone "$OUT" 2>&1)
TOUCH_RC=$?
while IFS= read -r row; do ROWS+=("$row"); done < <(grep '^| ' <<<"$TOUCH")
if [ "$TOUCH_RC" != 0 ]; then FAILS=$((FAILS + 1)); grep -q '| FAIL |' <<<"$TOUCH" || ROWS+=("| phone touch | FAIL | ${TOUCH//$'\n'/ } |"); fi

js '(() => { window.__scape.world.getState().setNow(); return "ok"; })()' >/dev/null 2>&1
ab set viewport 1400 900 >/dev/null 2>&1

echo "| check | result | detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "screenshots: $OUT"
exit $((FAILS > 0))
