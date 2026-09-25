#!/usr/bin/env bash
# Phase arrays are read through namerefs.
# shellcheck disable=SC2034
# Smoke test for the viewfinder eclipse look: the 2025-09-07 lunar eclipse phases from New Delhi (clear before and after) and the 2026-08-12 solar eclipse.
# Usage: scripts/smoke/eclipse.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port, a browser with remote debugging on the CDP port, and uv (for pixel sampling).
set -uo pipefail

PORT=${1:-5300}
CDP=${2:-9340}
OUT=${3:-${TMPDIR:-/tmp}/eclipse}
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

DELHI="28.6,77.2"
MADRID="40.4,-3.683"
REYKJAVIK="64.15,-21.85"
# Lunar phases: instant, refracted moon azimuth and altitude, disc-averaged light range.
BEFORE=("2025-09-07T14:55:00Z" 113.613 23.747 1 1)
P1=("2025-09-07T15:40:00Z" 121.079 32.426 0.98 1.01)
PEN=("2025-09-07T16:20:00Z" 129.212 39.572 0.6 0.75)
U1=("2025-09-07T16:50:00Z" 136.573 44.403 0.12 0.26)
# Midway U1–U2: half the disc in the umbra.
HALF=("2025-09-07T16:59:00Z" 139.033 45.736 0.07 0.12)
MAX=("2025-09-07T18:11:43Z" 163.757 53.645 0.00005 0.001)
U3=("2025-09-07T19:25:00Z" 194.373 54.265 0.06 0.15)
AFTER=("2025-09-07T21:30:00Z" 233.982 39.205 1 1)
# Solar: Madrid partial before maximum, Reykjavik mid-totality; refracted sun position.
PARTIAL=("2026-08-12T18:10:00Z" 279.857 11.424)
TOTAL=("2026-08-12T17:48:38Z" 252.789 24.512)

shoot() { # camera, instant, focal, orientation, az, alt, png
  go "$BASE/viewfinder?camera=$1&t=$2&f=$3$([ "$4" = P ] && echo '&o=p')"
  sleep 1.5
  js "(() => { window.__scape.composition.getState().aim($5, $6); return 'ok'; })()" >/dev/null
  sleep 1
  # A background window gets no animation frames; each screenshot forces one.
  ab screenshot "$7" >/dev/null
  sleep 0.5
  ab screenshot "$7" >/dev/null
}

# Moon disc: "light cx cy r nx ny umbra" in css px, with (nx, ny) the unit step toward the shadow axis (0 0 without one).
MOON='(() => { const m = window.__scape.moonDisc; if (!m) return "none"; const s = m.shadow; let nx = 0, ny = 0; if (s) { const h = Math.hypot(s.x - m.x, s.y - m.y) || 1; nx = (s.x - m.x) / h; ny = (s.y - m.y) / h; } return `${m.eclipseLight} ${m.x} ${m.y} ${m.radiusPx} ${nx} ${ny} ${m.umbra}`; })()'

# Mean "r g b" of device pixels within a css radius of each css point.
patches() { # png, css radius, x1 y1 [x2 y2 ...]
  uv run -q --with pillow python3 - "$@" "$(js 'window.innerWidth')" <<'PY'
import sys
from PIL import Image
img = Image.open(sys.argv[1]).convert("RGB")
k = img.width / float(sys.argv[-1])
rad = max(1.0, float(sys.argv[2]) * k)
pts = [float(v) for v in sys.argv[3:-1]]
out = []
for i in range(0, len(pts), 2):
    cx, cy = pts[i] * k, pts[i + 1] * k
    px = [img.getpixel((x, y)) for x in range(int(cx - rad), int(cx + rad) + 1) for y in range(int(cy - rad), int(cy + rad) + 1)
          if 0 <= x < img.width and 0 <= y < img.height and (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad]
    n = max(1, len(px))
    out += [round(sum(p[c] for p in px) / n) for c in range(3)]
print(*out)
PY
}

# Copper, moon-white and total device pixels within 0.9 of the disc radius.
copper() { # png, css x, css y, css radius
  uv run -q --with pillow python3 - "$@" "$(js 'window.innerWidth')" <<'PY'
import sys
from PIL import Image
img = Image.open(sys.argv[1]).convert("RGB")
k = img.width / float(sys.argv[5])
cx, cy, r = float(sys.argv[2]) * k, float(sys.argv[3]) * k, 0.9 * float(sys.argv[4]) * k
px = [img.getpixel((x, y)) for x in range(int(cx - r), int(cx + r) + 1) for y in range(int(cy - r), int(cy + r) + 1)
      if 0 <= x < img.width and 0 <= y < img.height and (x - cx) ** 2 + (y - cy) ** 2 <= r * r]
print(sum(1 for p in px if p[0] > 30 and p[0] > 1.5 * p[2] and p[0] > p[1] + 15), sum(1 for p in px if min(p) > 170 and p[2] - p[0] < 50), len(px))
PY
}

# Counts of sun-coloured, dark and glare-bright device pixels over the sun disc, at least 12 css px round.
sun_px() { # png
  local geo; geo=$(js '(() => { const r = document.querySelector(".vf-gl").getBoundingClientRect(); const s = window.__scape.overlay?.bodies?.Sun; return s ? `${r.x + s.x} ${r.y + s.y} ${s.r} ${window.innerWidth}` : `${r.x + r.width / 2} ${r.y + r.height / 2} 12 ${window.innerWidth}`; })()')
  # shellcheck disable=SC2086
  uv run -q --with pillow python3 - "$1" $geo <<'PY'
import sys
from PIL import Image
img = Image.open(sys.argv[1]).convert("RGB")
k = img.width / float(sys.argv[5])
cx, cy, r = float(sys.argv[2]) * k, float(sys.argv[3]) * k, max(12.0, float(sys.argv[4])) * k
step = max(1, int(r / 40))
px = [img.getpixel((x, y)) for x in range(max(0, int(cx - r)), min(img.width, int(cx + r)), step) for y in range(max(0, int(cy - r)), min(img.height, int(cy + r)), step)
      if (x - cx) ** 2 + (y - cy) ** 2 <= r * r]
sun = sum(1 for p in px if p[0] > 240 and p[1] > 225 and 150 < p[2] < 225)
dark = sum(1 for p in px if max(p) < 90)
# At 24 mm the disc is a few pixels under the glare, so "bright" stands in for the sun colour.
print(sun, dark, sum(1 for p in px if min(p) > 215))
PY
}

in_range() { awk -v v="$1" -v lo="$2" -v hi="$3" 'BEGIN { print (v >= lo && v <= hi) ? 1 : 0 }'; }

lunar_case() { # label, phase array name, focal, orientation
  local -n ph=$2
  local f=$3 o=$4 png
  png="$OUT/lunar-$2-$3-$4$([ "$1" = phone ] && echo -phone).png"
  shoot "$DELHI" "${ph[0]}" "$f" "$o" "${ph[1]}" "${ph[2]}" "$png"
  local geo light cx cy r nx ny umbra
  geo=$(js "$MOON")
  if [ "$geo" = none ]; then check "$1 lunar $2 ${f} mm $o: moon disc" 0 "no disc"; return; fi
  read -r light cx cy r nx ny umbra <<<"$geo"
  check "$1 lunar $2 ${f} mm $o: eclipse light" "$(in_range "$light" "${ph[3]}" "${ph[4]}")" "$light"
  local pr; pr=$(awk -v r="$r" 'BEGIN { print (r > 6 ? r * 0.2 : r * 0.4) }')
  local near far
  near=$(awk -v x="$cx" -v y="$cy" -v r="$r" -v nx="$nx" -v ny="$ny" 'BEGIN { print x + 0.65 * r * nx, y + 0.65 * r * ny }')
  far=$(awk -v x="$cx" -v y="$cy" -v r="$r" -v nx="$nx" -v ny="$ny" 'BEGIN { print x - 0.65 * r * nx, y - 0.65 * r * ny }')
  # shellcheck disable=SC2086
  local c; c=$(patches "$png" "$pr" "$cx" "$cy" $near $far)
  local r0 g0 b0 r1 g1 b1 r2 g2 b2
  read -r r0 g0 b0 r1 g1 b1 r2 g2 b2 <<<"$c"
  case $2 in
  BEFORE | P1 | AFTER)
    [ "$2" = BEFORE ] && CLEAR_SUM=$((r0 + g0 + b0))
    check "$1 lunar $2 ${f} mm $o: bright neutral disc" "$([ "$g0" -gt 120 ] && [ $((r0 - b0)) -lt 60 ] && echo 1 || echo 0)" "rgb $r0 $g0 $b0"
    ;;
  PEN) check "$1 lunar PEN ${f} mm $o: slightly dimmed, still neutral" "$([ "$g0" -gt 100 ] && [ $((r0 - b0)) -lt 60 ] && [ $((r0 + g0 + b0)) -lt "${CLEAR_SUM:-999}" ] && echo 1 || echo 0)" "rgb $r0 $g0 $b0, clear sum ${CLEAR_SUM:-?}" ;;
  HALF)
    check "$1 lunar HALF ${f} mm $o: half the disc in the umbra" "$(in_range "$umbra" 0.4 0.6)" "$umbra"
    if [ "$f" -ge 200 ]; then
      check "$1 lunar HALF ${f} mm $o: umbral half red and dark, other half bright" "$([ "$r1" -gt "$g1" ] && [ "$r1" -gt "$b1" ] && [ $((2 * (r1 + g1 + b1))) -lt $((r2 + g2 + b2)) ] && [ "$g2" -gt 100 ] && echo 1 || echo 0)" "umbral $r1 $g1 $b1, lit $r2 $g2 $b2"
    else
      check "$1 lunar HALF ${f} mm $o: disc visible" "$([ $((r0 + g0 + b0)) -gt 90 ] && echo 1 || echo 0)" "rgb $r0 $g0 $b0"
    fi
    ;;
  MAX)
    local n white all; read -r n white all < <(copper "$png" "$cx" "$cy" "$r")
    if [ "$f" -ge 200 ]; then
      check "$1 lunar MAX ${f} mm $o: copper, not white" "$([ $((n * 4)) -ge "$all" ] && [ "$g0" -lt 150 ] && echo 1 || echo 0)" "copper $n of $all px, far limb rgb $r2 $g2 $b2"
    else
      # A 2 px disc sits under the aim mark and path line.
      check "$1 lunar MAX ${f} mm $o: not white" "$([ "$white" -le 1 ] && echo 1 || echo 0)" "white $white of $all px"
    fi
    ;;
  *)
    if [ "$f" -ge 200 ]; then
      check "$1 lunar $2 ${f} mm $o: limb toward the shadow darker" "$([ $((r1 + g1 + b1 + 30)) -lt $((r2 + g2 + b2)) ] && echo 1 || echo 0)" "near $r1 $g1 $b1, far $r2 $g2 $b2"
    else
      check "$1 lunar $2 ${f} mm $o: disc visible" "$([ $((r0 + g0 + b0)) -gt 90 ] && echo 1 || echo 0)" "rgb $r0 $g0 $b0"
    fi
    ;;
  esac
}

solar_case() { # label, kind, camera, phase array name, focal, orientation
  local -n ph=$4
  local f=$5 o=$6 png
  png="$OUT/solar-$2-$5-$6$([ "$1" = phone ] && echo -phone).png"
  shoot "$3" "${ph[0]}" "$f" "$o" "${ph[1]}" "${ph[2]}" "$png"
  local sun dark bright; read -r sun dark bright < <(sun_px "$png")
  if [ "$2" = total ]; then
    check "$1 solar total ${f} mm $o: moon covers the sun" "$([ "$sun" = 0 ] && [ "$dark" -gt 0 ] && echo 1 || echo 0)" "sun $sun, dark $dark px"
  elif [ "$f" -ge 200 ]; then
    check "$1 solar partial ${f} mm $o: sun with a dark bite" "$([ $((sun + bright)) -gt 0 ] && [ "$dark" -gt 0 ] && echo 1 || echo 0)" "sun $sun, dark $dark px"
  else
    check "$1 solar partial ${f} mm $o: sun visible" "$([ $((sun + bright)) -gt 0 ] && echo 1 || echo 0)" "sun $sun, bright $bright px"
  fi
}

ab set viewport 1400 900 >/dev/null
for f in 24 200 600 2400; do
  for o in L P; do
    for ph in BEFORE P1 PEN U1 HALF MAX U3 AFTER; do lunar_case desktop "$ph" "$f" "$o"; done
    solar_case desktop partial "$MADRID" PARTIAL "$f" "$o"
    solar_case desktop total "$REYKJAVIK" TOTAL "$f" "$o"
  done
done

ab set viewport 390 844 >/dev/null
lunar_case phone MAX 200 P
lunar_case phone U1 600 P
lunar_case phone BEFORE 600 P
lunar_case phone HALF 600 P
solar_case phone total "$REYKJAVIK" TOTAL 200 P
ab set viewport 1400 900 >/dev/null

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
