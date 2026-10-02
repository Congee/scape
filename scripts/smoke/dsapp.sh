#!/usr/bin/env bash
# Design-system smoke: no old accent blue, dark click-mode, underlined calendar day, square chrome, 390 px topbar, keyboard context menu,
# danger import row with an icon instead of a frame, 390 px rail tab filling its cell, one-line field labels,
# no date or time at the panel top (place band when named) or the phone peek bar (the DateBar owns them).
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
# Every field label is one line tall.
labels_check() { # where
  local l
  l=$(js '(() => { const ls = [...document.querySelectorAll(".field > span:first-child")].filter((e) => e.offsetParent); const bad = ls.filter((e) => Math.abs(e.getBoundingClientRect().height - parseFloat(getComputedStyle(e).lineHeight)) > 0.5).map((e) => e.textContent); return `${ls.length} ${JSON.stringify(bad)}`; })()')
  check "$1: field labels on one line" "$([[ "$l" == *" []" && "${l%% *}" -gt 0 ]] && echo 1 || echo 0)" "$l"
  l=$(js '(() => { const g = new Map(); for (const f of document.querySelectorAll(".field")) { if (!f.offsetParent) continue; const k = f.closest("section") ?? f.parentElement; g.set(k, [...(g.get(k) ?? []), Math.round(f.lastElementChild.getBoundingClientRect().right)]); } const bad = [...g.values()].filter((r) => new Set(r).size > 1); return `${g.size} ${JSON.stringify(bad)}`; })()')
  check "$1: field controls share a right edge per section" "$([[ "$l" == *" []" && "${l%% *}" -gt 0 ]] && echo 1 || echo 0)" "$l"
}
# No danger frames: every .danger keeps a non-danger border and leads with the danger icon.
danger_check() { # where
  local d
  d=$(js '(() => { const red = "rgb(255, 92, 92)"; const es = [...document.querySelectorAll(".danger")].filter((e) => e.offsetParent); const bad = es.filter((e) => { const s = getComputedStyle(e); const i = e.querySelector(":scope > svg.icon"); return [s.borderTopColor, s.borderLeftColor].includes(red) && parseFloat(s.borderTopWidth) > 0 || !i || getComputedStyle(i).color !== red; }).map((e) => e.className); return `${es.length} ${JSON.stringify(bad)}`; })()')
  check "$1: danger without a frame, with the icon" "$([[ "$d" == *" []" && "${d%% *}" -gt 0 ]] && echo 1 || echo 0)" "$d"
}
# The DateBar owns date and time; the panel top (band, or the peek bar when collapsed) must not repeat them.
DATE_RE='\\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,|\\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \\d|\\d{1,2}:\\d{2}|\\b[AP]M\\b|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}'
band_check() { # where, selector
  local t
  t=$(js "(() => { const es = [...document.querySelectorAll('$2')].filter((e) => e.getClientRects().length); const t = es.map((e) => e.innerText).join(' | ').replace(/\\s+/g, ' '); return \`\${es.length} \${new RegExp('$DATE_RE').test(t)} \${t}\`; })()")
  check "$1: no date or time" "$([[ "$t" == [1-9]*" false "* ]] && echo 1 || echo 0)" "$t"
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
ab open "$BASE/viewfinder" >/dev/null
# Collapsing persists; open the panel so its top shows. An unnamed spot has no band, so the tabs lead.
wait_for '!!document.querySelector(".panel-inner")' 80
js '(() => { document.querySelector(".panel-expand")?.click(); return "ok"; })()' >/dev/null
wait_for '!!document.querySelector(".panel-inner .tabs")' 40
band_check "viewfinder panel top" ".panel-inner > :first-child"
ab open "$BASE/" >/dev/null
styled 120
band_check "map panel top" ".panel-inner > :first-child"

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
  danger_check "$p"
  [ "$p" = library ] || continue
  # The replace-import row: no frame, a danger icon, lined up with the merge row.
  d=$(js '(() => { const [m, e] = document.querySelectorAll("label.file"); const s = getComputedStyle(e); const i = e.querySelector(":scope > svg.icon"); return `${s.borderTopWidth} ${s.borderLeftStyle} ${!!i && getComputedStyle(i).color === "rgb(255, 92, 92)"} ${Math.round(m.getBoundingClientRect().left - e.getBoundingClientRect().left)} ${Math.round(m.getBoundingClientRect().width - e.getBoundingClientRect().width)}`; })()')
  check "danger import: no border, danger icon, aligned with merge row" "$([ "$d" = "0px none true 0 0" ] && echo 1 || echo 0)" "border, style, icon, left/width delta: $d"
done
labels_check "settings 1600"
js '(() => { [...document.querySelectorAll(".page .btn.danger")].find((b) => /Restore/.test(b.textContent)).click(); return "ok"; })()' >/dev/null
wait_for '!!document.querySelector(".confirm .btn.danger")' 20
danger_check "settings confirm"
ab screenshot "$OUT/dsapp-confirm.png" >/dev/null
ab press Escape >/dev/null

# Topbar fits at phone width.
ab set viewport 390 844 >/dev/null
ab open "$BASE/" >/dev/null
styled 120
w=$(js '(() => { const t = document.querySelector(".topbar"); const d = document.documentElement; return `${t.scrollWidth} ${t.clientWidth} ${d.scrollWidth} ${d.clientWidth}`; })()')
check "topbar fits at 390 px" "$(echo "$w" | awk '{ print ($1 <= $2 && $3 <= $4) ? 1 : 0 }')" "topbar scroll/client, page scroll/client: $w"
ab screenshot "$OUT/dsapp-390.png" >/dev/null

# The current-view tab fills its quarter of the bottom bar.
c=$(js '(() => { const r = document.querySelector(".rail"); const a = r.querySelector(".rail-link[aria-current=page]").getBoundingClientRect(); const b = r.getBoundingClientRect(); const n = r.querySelectorAll(".rail-link").length; return `${Math.abs(a.width - r.clientWidth / n) < 1 && Math.abs(a.height - r.clientHeight) < 1 && Math.abs(a.bottom - b.bottom) < 1} ${a.width.toFixed(1)}x${a.height.toFixed(1)} of ${b.width}x${r.clientHeight} / ${n}`; })()')
check "390 px: active rail tab fills its cell, >= 44x44" "$([[ "$c" == true* ]] && echo "$c" | awk '{ split($2, s, "x"); print (s[1] >= 44 && s[2] >= 44) ? 1 : 0 }' || echo 0)" "$c"

js '(() => { if (!document.querySelector(".panel-collapsed")) document.querySelector(".tabs-collapse").click(); return "ok"; })()' >/dev/null
wait_for '!!document.querySelector(".panel-collapsed")' 20
band_check "390 peek bar" ".panel-inner > *"
js '(() => { document.querySelector(".tabs-collapse").click(); return "ok"; })()' >/dev/null

ab open "$BASE/settings" >/dev/null
wait_for '!!document.querySelector(".page h2")' 80
labels_check "settings 390"

[ "$BRAVE" = 1 ] && brave_stop "$PROFILE" && rm -rf "$PROFILE"

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
