#!/usr/bin/env bash
# Smoke test for the Tools tab calculators and the viewfinder rainbow.
# Usage: scripts/smoke/extras-calc.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port and a browser with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5290}
CDP=${2:-9339}
OUT=${3:-${TMPDIR:-/tmp}/extras-calc}
BASE="http://localhost:$PORT"
mkdir -p "$OUT"

# Its own agent-browser session: "default" is shared with every other agent.
SESSION=${AGENT_BROWSER_SESSION:-smoke-$CDP}
ab() { agent-browser --cdp "${CDP:?no CDP port}" --session "$SESSION" "$@"; }
# agent-browser prints eval results JSON-encoded; strip the string quotes.
js() { ab eval "$1" | sed -e 's/^"//' -e 's/"$//' -e 's/\\"/"/g'; }

FAILS=0
ROWS=()
check() { # name, ok (0/1), detail
  local status=PASS
  if [ "$2" != 1 ]; then status=FAIL; FAILS=$((FAILS + 1)); fi
  ROWS+=("| $1 | $status | $3 |")
}

# Seattle, 2026-06-21 18:30 PDT: sun +23.9° at 279°, so the bow top stands near 99°, +18°.
CAM="47.6,-122.3"
LATE="2026-06-22T01:30Z"
NOON="2026-06-21T20:00Z"
NIGHT="2026-06-22T08:00Z"
TOP_AZ=99.3
TOP_ALT=18.2

wait_for() { # js condition, tries of 0.25 s
  local i
  for ((i = 0; i < ${2:-40}; i++)); do
    [ "$(js "!!($1)")" = true ] && return 0
    sleep 0.25
  done
  return 1
}

# Retries: a fresh navigation sometimes reports ERR_INTERNET_DISCONNECTED.
go() {
  local i
  for i in 1 2 3; do
    ab open "$1" >/dev/null 2>&1 && wait_for 'window.__scape && document.querySelector(".tabs button")' && return 0
    sleep 1
  done
  return 1
}

# The panel can re-mount while the page settles; retry a missed field once it is back.
put() { # fill|select, aria-label, value
  local tag=input i
  [ "$1" = select ] && tag=select
  for i in 1 2 3; do
    ab "$1" "$tag[aria-label=\"$2\"]" "$3" >/dev/null 2>&1 && return 0
    open_tools
  done
  echo "could not $1 $2" >&2
}

open_tools() {
  wait_for '[...document.querySelectorAll(".tabs button")].some((b) => b.textContent === "Tools")'
  js '[...document.querySelectorAll(".tabs button")].find((b) => b.textContent === "Tools")?.click(); "ok"' >/dev/null
  wait_for 'document.querySelectorAll(".tools details").length >= 5'
  # Open every group once; the panel remembers them across tab switches.
  js 'document.querySelectorAll(".tools details").forEach((d) => { d.open = true; }); "ok"' >/dev/null
  sleep 0.3
}

kv() { # value cell after a key label inside a group
  wait_for "document.querySelectorAll('.tools details').length >= 5" 8 || { echo "no panel ($(js 'location.href + " scape " + !!window.__scape + " mark " + !!window.__smokeMark'))"; return; }
  js "(() => { const g = [...document.querySelectorAll('.tools details')][$1]; const k = [...g.querySelectorAll('.kv .k')].find((e) => e.textContent === '$2'); return k ? k.nextElementSibling.textContent : 'missing'; })()"
}

panel_checks() { # label
  local tag=$1
  open_tools
  js 'window.__smokeMark = 1; "ok"' >/dev/null
  put select 'Exposure term to solve for' Shutter
  put fill 'Aperture, f-number' 16
  put fill 'ISO' 100
  put fill 'Exposure value at ISO 100' 15
  local sh; sh=$(kv 0 Shutter)
  check "$tag exposure: f/16 ISO 100 EV 15 → 1/125" "$([[ $sh == *1/125* ]] && echo 1 || echo 0)" "$sh"
  put select 'Exposure term to solve for' Ev
  put fill 'Shutter time, like 1/250 or 30s' 1
  put fill 'Aperture, f-number' 1
  local ev; ev=$(kv 0 EV100)
  check "$tag exposure: f/1 1 s ISO 100 → EV 0" "$([[ $ev == 'EV 0.0' ]] && echo 1 || echo 0)" "$ev"
  local scenes; scenes=$(js "document.querySelectorAll('.tools details')[0].querySelectorAll('.list li').length")
  check "$tag exposure: scene rows from the sky" "$([ "${scenes:-0}" -gt 0 ] && echo 1 || echo 0)" "$scenes rows"

  put fill 'Filter strength, stops' 10
  put fill 'Shutter without the filter' 1/30
  local nd; nd=$(kv 1 'With filter')
  local od; od=$(js "document.querySelector('input[aria-label=\"Optical density\"]').value")
  check "$tag ND: 10 stops, 1/30 → 34 s, OD 3.0" "$([[ $nd == '34 s' && $od == 3.0 ]] && echo 1 || echo 0)" "$nd, OD $od"
  put fill 'Filter factor, ND number' 64
  local st; st=$(js "document.querySelector('input[aria-label=\"Filter strength, stops\"]').value")
  check "$tag ND: ND64 → 6 stops" "$([ "$st" = 6 ] && echo 1 || echo 0)" "$st stops"

  put select 'Time-lapse term to solve for' Clip
  put fill 'Interval, seconds' 1
  put fill 'Event duration, minutes' 20
  put fill 'Frames per second' 25
  put fill 'Megabytes per shot' 50
  local shots clip card; shots=$(kv 2 Shots); clip=$(kv 2 'Clip length'); card=$(kv 2 'Card space')
  check "$tag time-lapse: 1 s over 20 min at 25 fps, 50 MB → 1200 shots, 48 s, 60 GB" "$([[ $shots == 1200* && $clip == '48.0 s' && $card == '60'*GB ]] && echo 1 || echo 0)" "$shots; $clip; card $card"

  put select 'Cloud term to solve for' Distance
  put fill 'Cloud base above the ground' 2000
  put fill 'Angle up to the cloud, degrees' 5
  local cd; cd=$(kv 4 Distance)
  local km; km=$(echo "$cd" | sed -E 's/ km//')
  check "$tag clouds: 2000 m at 5° → about 21 km" "$(awk -v d="$km" 'BEGIN { print (d > 19 && d < 23) ? 1 : 0 }')" "$cd"
  local lit; lit=$(kv 4 'Stays lit until')
  check "$tag clouds: 2000 m stays lit until sun -1.4°" "$([[ $lit == *-1.4°* ]] && echo 1 || echo 0)" "$lit"

  local bow; bow=$(js "document.querySelectorAll('.tools details')[3].querySelector('summary').textContent")
  check "$tag rainbow group summary" "$([[ $bow == 'Rainbow possible'* ]] && echo 1 || echo 0)" "$bow"
  local wide; wide=$(js 'document.documentElement.scrollWidth > window.innerWidth')
  check "$tag no sideways page scroll" "$([ "$wide" = false ] && echo 1 || echo 0)" "overflow $wide"
  ab screenshot "$OUT/panel-$tag.png" >/dev/null
}

bow_count() { # focal, orientation, instant, aim az, aim alt, screenshot → clear+dim samples drawn in frame
  go "$BASE/viewfinder?camera=$CAM&t=$3&f=$1$([ "$2" = P ] && echo '&o=p')"
  sleep 1.5
  js "(() => { const c = window.__scape.composition.getState(); c.update({ showRainbow: true }); c.aim($4, $5); window.__bowFrom = Date.now(); return 'ok'; })()" >/dev/null
  sleep 1
  # A background window gets no animation frames; each screenshot forces one.
  local i
  for i in 1 2 3 4 5; do
    ab screenshot "$6" >/dev/null
    [ "$(js '!!(window.__scape.rainbow && window.__scape.rainbow.at > window.__bowFrom)')" = true ] && break
    sleep 0.5
  done
  sleep 0.5
  ab screenshot "$6" >/dev/null
  js '(() => { const r = window.__scape.rainbow; return r && r.at > window.__bowFrom ? r.clear + r.dim : -1; })()'
}

# Desktop panel.
ab set viewport 1400 900 >/dev/null
go "$BASE/viewfinder?camera=$CAM&t=$LATE&f=24"
panel_checks desktop

# Time-lapse simulation steps the clock by the interval.
put fill 'Interval, seconds' 60
t0=$(js 'window.__scape.world.getState().time')
js '[...document.querySelectorAll(".tl-sim button")].find((b) => b.textContent === "Play").click(); "ok"' >/dev/null
sleep 1
js '[...document.querySelectorAll(".tl-sim button")].find((b) => b.textContent === "Pause").click(); "ok"' >/dev/null
t1=$(js 'window.__scape.world.getState().time')
d=$(( (t1 - t0) / 1000 ))
check "time-lapse sim: play steps the clock by 60 s multiples" "$([ "$d" -gt 0 ] && [ $((d % 60)) -eq 0 ] && echo 1 || echo 0)" "+$d s in 1 s"
ab screenshot "$OUT/timelapse-sim.png" >/dev/null
js '[...document.querySelectorAll(".tl-sim button")].find((b) => b.textContent === "Reset").click(); "ok"' >/dev/null
t2=$(js 'window.__scape.world.getState().time')
check "time-lapse sim: reset returns to the start" "$([ "$t2" = "$t0" ] && echo 1 || echo 0)" "Δ $(( (t2 - t0) / 1000 )) s"

# Viewfinder rainbow: focal × orientation × day/night, plus noon.
for f in 24 200 600 2400; do
  for o in L P; do
    if [ "$f" = 24 ]; then az=$TOP_AZ; alt=10; else az=$TOP_AZ; alt=$TOP_ALT; fi
    n=$(bow_count "$f" "$o" "$LATE" "$az" "$alt" "$OUT/bow-$f-$o-day.png")
    check "rainbow ${f} mm $o late afternoon, sun behind" "$([ "${n:-0}" -gt 0 ] && echo 1 || echo 0)" "$n samples"
    n=$(bow_count "$f" "$o" "$NIGHT" "$az" "$alt" "$OUT/bow-$f-$o-night.png")
    check "rainbow ${f} mm $o night" "$([ "$n" = 0 ] && echo 1 || echo 0)" "$n samples"
  done
done
for o in L P; do
  n=$(bow_count 24 "$o" "$NOON" 354 10 "$OUT/bow-24-$o-noon.png")
  check "rainbow 24 mm $o noon (sun +66°)" "$([ "$n" = 0 ] && echo 1 || echo 0)" "$n samples"
done

# Phone.
ab set viewport 390 844 >/dev/null
n=$(bow_count 24 P "$LATE" "$TOP_AZ" 10 "$OUT/bow-phone.png")
check "phone 390×844 rainbow 24 mm portrait" "$([ "${n:-0}" -gt 0 ] && echo 1 || echo 0)" "$n samples"
panel_checks phone

js '(() => { window.__scape.composition.getState().update({ showRainbow: false }); return "ok"; })()' >/dev/null
ab set viewport 1400 900 >/dev/null

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
