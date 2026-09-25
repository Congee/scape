#!/usr/bin/env bash
# Smoke test for the tides panel, the Calendar eclipse detail, the viewfinder eclipse discs and path labels kept off them.
# Usage: scripts/smoke/extras-astro.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port, a browser with remote debugging on the CDP port, and uv (for pixel sampling).
set -uo pipefail

PORT=${1:-5300}
CDP=${2:-9340}
OUT=${3:-${TMPDIR:-/tmp}/extras-astro}
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

HOBOKEN="40.744,-74.0324"
DENVER="39.74,-104.99"
MADRID="40.4,-3.683"
REYKJAVIK="64.15,-21.85"
DELHI="28.6,77.2"
# Reykjavik 2026-08-12: mid-totality and a control before C1, with the refracted sun position.
TOTAL_T="2026-08-12T17:48:38Z"; TOTAL_AZ=252.79; TOTAL_ALT=24.512
CTRL_T="2026-08-12T16:30:00Z"; CTRL_AZ=232.972; CTRL_ALT=32.121
# New Delhi, 2025-09-07 lunar eclipse maximum.
LUNAR_T="2025-09-07T18:11:43Z"; LUNAR_AZ=163.757; LUNAR_ALT=53.645

TIDES='[...document.querySelectorAll(".tools details")].find((d) => d.querySelector("summary")?.textContent.startsWith("Tides"))'

open_tides() { # camera
  go "$BASE/viewfinder?camera=$1&t=2026-10-15T15:00Z&f=24"
  wait_for '[...document.querySelectorAll(".tabs button")].some((b) => b.textContent === "Tools")'
  js '[...document.querySelectorAll(".tabs button")].find((b) => b.textContent === "Tools")?.click(); "ok"' >/dev/null
  wait_for "$TIDES"
  js "(() => { const g = $TIDES; g.open = true; g.scrollIntoView(); return 'ok'; })()" >/dev/null
  wait_for "!$TIDES.querySelector('summary').textContent.includes('loading')" 60
  sleep 0.3
}

tide_checks() { # label
  open_tides "$HOBOKEN"
  local sum rows curve hint wide
  sum=$(js "$TIDES.querySelector('summary').textContent")
  check "$1 tides at Hoboken: The Battery is nearest" "$([[ $sum == *'NEW YORK (The Battery)'* ]] && echo 1 || echo 0)" "$sum"
  rows=$(js "$TIDES.querySelectorAll('.nd-table tr').length")
  check "$1 tides: 3–4 highs and lows today" "$([ "${rows:-0}" -ge 3 ] && [ "${rows:-0}" -le 4 ] && echo 1 || echo 0)" "$rows rows"
  curve=$(js "$TIDES.querySelectorAll('.tide-curve polyline').length")
  check "$1 tides: day curve drawn" "$([ "${curve:-0}" -ge 1 ] && echo 1 || echo 0)" "$curve polyline"
  hint=$(js "$TIDES.textContent.includes('NOAA CO-OPS')")
  check "$1 tides: NOAA CO-OPS attribution" "$([ "$hint" = true ] && echo 1 || echo 0)" "$hint"
  wide=$(js 'document.documentElement.scrollWidth > window.innerWidth')
  check "$1 no sideways page scroll" "$([ "$wide" = false ] && echo 1 || echo 0)" "overflow $wide"
  ab screenshot "$OUT/tides-$1.png" >/dev/null
}

eclipse_checks() { # label
  go "$BASE/viewfinder?camera=$MADRID&t=2026-08-12T18:00Z&f=24"
  wait_for 'document.querySelector(".cal-toggle")'
  js 'document.querySelector(".cal-toggle").click(); "ok"' >/dev/null
  wait_for 'document.querySelector(".cal-eclipse tr")' 20
  local head kinds last wide
  head=$(js 'document.querySelector(".cal-eclipse .cal-eclipse-head")?.textContent ?? "missing"')
  check "$1 Madrid 2026-08-12: partial solar eclipse, magnitude ~0.999" "$([[ $head == 'Partial solar eclipse'*'magnitude 0.99'* ]] && echo 1 || echo 0)" "$head"
  kinds=$(js '[...document.querySelector(".cal-eclipse").querySelectorAll("tr")].map((r) => r.cells[0].textContent).join(" ")')
  check "$1 contacts C1 Max C4" "$([ "$kinds" = 'C1 Max C4' ] && echo 1 || echo 0)" "$kinds"
  last=$(js '(() => { const r = [...document.querySelector(".cal-eclipse").querySelectorAll("tr")].at(-1); return r.className + " " + r.cells[2].textContent + " " + r.cells[4].textContent; })()')
  check "$1 C4 after sunset is marked hidden" "$([[ $last == hidden* && ( $last == *below* || $last == *terrain* ) ]] && echo 1 || echo 0)" "$last"
  wide=$(js 'document.documentElement.scrollWidth > window.innerWidth')
  check "$1 calendar: no sideways page scroll" "$([ "$wide" = false ] && echo 1 || echo 0)" "overflow $wide"
  ab screenshot "$OUT/eclipse-$1.png" >/dev/null
}

# Counts of sun-coloured, dark, moon-white, glare-bright and copper device pixels within 12 css px of the picture centre.
centre_px() { # png, css x, css y, css width
  uv run -q --with pillow python3 - "$@" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
s = im.width / float(sys.argv[4])
x, y, r = round(float(sys.argv[2]) * s), round(float(sys.argv[3]) * s), round(12 * s)
px = [im.getpixel((x + dx, y + dy)) for dx in range(-r, r + 1) for dy in range(-r, r + 1)]
sun = sum(1 for p in px if p[0] > 240 and p[1] > 225 and 150 < p[2] < 225)
dark = sum(1 for p in px if max(p) < 90)
white = sum(1 for p in px if min(p) > 170 and p[2] - p[0] < 50)
# At 24 mm the disc is a few pixels under the glare, so "bright" stands in for the sun colour.
# An eclipsed moon is copper, not white.
red = sum(1 for p in px if p[0] > 25 and p[0] > 1.6 * p[2] and p[0] > p[1])
print(sun, dark, white, sum(1 for p in px if min(p) > 215), red)
PY
}

vf_shot() { # camera, instant, focal, orientation, az, alt, png → "sun dark white bright red" pixel counts
  go "$BASE/viewfinder?camera=$1&t=$2&f=$3$([ "$4" = P ] && echo '&o=p')"
  sleep 1.5
  js "(() => { window.__scape.composition.getState().aim($5, $6); return 'ok'; })()" >/dev/null
  sleep 1
  # A background window gets no animation frames; each screenshot forces one.
  ab screenshot "$7" >/dev/null
  sleep 0.5
  ab screenshot "$7" >/dev/null
  local geo; geo=$(js '(() => { const r = document.querySelector(".vf-gl").getBoundingClientRect(); return `${r.x + r.width / 2} ${r.y + r.height / 2} ${window.innerWidth}`; })()')
  # shellcheck disable=SC2086
  centre_px "$7" $geo
}

# Drawn path hour labels that touch a sun or moon disc (halo margin included), and how many were skipped.
LABEL_CLASH='(() => { const o = window.__scape.overlay; const discs = ["Sun", "Moon"].map((b) => o.bodies[b]).filter(Boolean); const hit = (l, d) => { const dx = d.x - Math.min(Math.max(d.x, l.x - 1.5), l.x + l.w + 1.5); const dy = d.y - Math.min(Math.max(d.y, l.y - 1.5), l.y + l.h + 1.5); return dx * dx + dy * dy <= d.r * d.r; }; const drawn = o.pathLabels.filter((l) => !l.skipped); return `${drawn.filter((l) => discs.some((d) => hit(l, d))).length} ${o.pathLabels.length - drawn.length} ${drawn.length}`; })()'

label_clash_check() { # name
  local bad skipped drawn
  read -r bad skipped drawn < <(js "$LABEL_CLASH")
  check "$1: no hour label drawn over a disc" "$([ "${bad:-1}" = 0 ] && echo 1 || echo 0)" "$drawn drawn, $skipped skipped, $bad over a disc"
}

# The overlay's 11:30 PM moon label: "skipped darkPx", darkPx counting its halo on the overlay canvas.
MOON_LABEL='(() => { const l = window.__scape.overlay.pathLabels.find((l) => l.body === "Moon" && l.text === "11:30 PM"); if (!l) return "missing 0"; const c = document.querySelector("canvas.vf"); const k = c.width / c.clientWidth; const d = c.getContext("2d").getImageData(Math.round(l.x * k), Math.round(l.y * k), Math.max(1, Math.round(l.w * k)), Math.round(l.h * k)).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 60 && d[i] + d[i + 1] + d[i + 2] < 150) n++; return `${l.skipped} ${n}`; })()'

scrub() { # 10-minute steps through the chart's own keys; negative goes back
  js "(() => { const c = document.querySelector('canvas.chart'); const n = $1; for (let i = 0; i < Math.abs(n); i++) c.dispatchEvent(new KeyboardEvent('keydown', { key: n > 0 ? 'ArrowRight' : 'ArrowLeft', shiftKey: true, bubbles: true })); return 'ok'; })()" >/dev/null
  sleep 0.5
  ab screenshot "$2" >/dev/null
  sleep 0.3
  ab screenshot "$2" >/dev/null
}

moon_label_case() { # label, orientation, png prefix
  local skipped dark
  vf_shot "$DELHI" "$LUNAR_T" 24 "$2" "$LUNAR_AZ" "$LUNAR_ALT" "$3-over.png" >/dev/null
  read -r skipped dark < <(js "$MOON_LABEL")
  check "$1 24 mm $2 lunar maximum: 11:30 PM label on the moon is skipped" "$([ "$skipped" = true ] && [ "$dark" = 0 ] && echo 1 || echo 0)" "skipped $skipped, halo $dark px"
  scrub 3 "$3-away.png"
  read -r skipped dark < <(js "$MOON_LABEL")
  check "$1 24 mm $2 +30 min: moon moved off, label drawn again" "$([ "$skipped" = false ] && [ "$dark" -gt 0 ] && echo 1 || echo 0)" "skipped $skipped, halo $dark px"
  scrub -3 "$3-back.png"
  read -r skipped dark < <(js "$MOON_LABEL")
  check "$1 24 mm $2 back to maximum: skipped again" "$([ "$skipped" = true ] && [ "$dark" = 0 ] && echo 1 || echo 0)" "skipped $skipped, halo $dark px"
}

ab set viewport 1400 900 >/dev/null
tide_checks desktop
open_tides "$DENVER"
sum=$(js "$TIDES.querySelector('summary').textContent")
check "tides at Denver: no station within 50 km" "$([[ $sum == *'no station within'* ]] && echo 1 || echo 0)" "$sum"
eclipse_checks desktop

# Viewfinder: day is the Reykjavik totality, night the New Delhi lunar eclipse.
for f in 24 200 600 2400; do
  for o in L P; do
    read -r sun dark white bright red < <(vf_shot "$REYKJAVIK" "$CTRL_T" "$f" "$o" "$CTRL_AZ" "$CTRL_ALT" "$OUT/vf-$f-$o-before.png")
    check "viewfinder ${f} mm $o before C1: sun disc at centre" "$([ $((sun + bright)) -gt 0 ] && echo 1 || echo 0)" "sun $sun, bright $bright px"
    label_clash_check "viewfinder ${f} mm $o before C1"
    read -r sun dark white bright red < <(vf_shot "$REYKJAVIK" "$TOTAL_T" "$f" "$o" "$TOTAL_AZ" "$TOTAL_ALT" "$OUT/vf-$f-$o-total.png")
    check "viewfinder ${f} mm $o totality (C2–C3): moon covers the sun" "$([ "$sun" = 0 ] && [ "$dark" -gt 0 ] && echo 1 || echo 0)" "sun $sun, dark $dark px"
    label_clash_check "viewfinder ${f} mm $o totality"
    read -r sun dark white bright red < <(vf_shot "$DELHI" "$LUNAR_T" "$f" "$o" "$LUNAR_AZ" "$LUNAR_ALT" "$OUT/vf-$f-$o-night.png")
    # At 24 mm the 2 px disc sits under the aim mark, so only "not white" is checkable.
    check "viewfinder ${f} mm $o night, lunar maximum: copper moon disc at centre" "$({ [ "$red" -gt 0 ] || [ "$f" = 24 ]; } && [ "$white" -le 1 ] && echo 1 || echo 0)" "red $red, white $white px"
    label_clash_check "viewfinder ${f} mm $o night"
  done
done
moon_label_case desktop L "$OUT/label-L"
moon_label_case desktop P "$OUT/label-P"

ab set viewport 390 844 >/dev/null
tide_checks phone
eclipse_checks phone
read -r sun dark white bright red < <(vf_shot "$REYKJAVIK" "$TOTAL_T" 200 P "$TOTAL_AZ" "$TOTAL_ALT" "$OUT/vf-phone-total.png")
check "phone 390×844 viewfinder 200 mm P totality" "$([ "$sun" = 0 ] && [ "$dark" -gt 0 ] && echo 1 || echo 0)" "sun $sun, dark $dark px"
moon_label_case "phone 390×844" P "$OUT/label-phone"
ab set viewport 1400 900 >/dev/null

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
