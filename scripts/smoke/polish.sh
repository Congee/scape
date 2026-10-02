#!/usr/bin/env bash
# Polish smoke: collapsed summaries fit and lead with the verdict; Map vs View building/shadow names; weekday chips on one row
# with full-weekday names; "horizon unknown" once per list (Open-Meteo stubbed in-page so sightline samples are missing).
# Usage: scripts/smoke/polish.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port; launches a headless Brave on the CDP port unless one answers, and stops only what it started.
set -uo pipefail

PORT=${1:-5476}
CDP=${2:-9476}
OUT=${3:-${TMPDIR:-/tmp}/polish}
BASE="http://localhost:$PORT"
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
. "$ROOT/scripts/smoke/brave.sh"
mkdir -p "$OUT"
PROFILE="$OUT/brave-profile"
CAM='camera=46.5476,7.9806&target=46.5775,8.0053'

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
go() { # path
  ab open "$BASE$1" >/dev/null
  wait_for 'window.__scape && document.querySelector("[role=tablist]")' 80
}
tab() { js "(() => { const u = window.__scape.ui.getState(); u.setPanelTab('$1'); u.setPanelCollapsed(false); return 'ok'; })()" >/dev/null; sleep 0.6; }
eq() { [ "$1" = "$2" ] && echo 1 || echo 0; }
# Visible collapsed summaries wider than their row.
TRUNC='[...document.querySelectorAll("#ptabpanel details > summary")].filter((s) => s.offsetParent && s.scrollWidth > s.clientWidth + 1).map((s) => s.textContent.trim()).join(" / ") || "none"'

# 1: no truncated summaries on any tab; Milky Way summary is the verdict, reasons in the body.
for vp in "desktop 1600 1000" "390 390 844"; do
  read -r name w h <<<"$vp"
  ab set viewport "$w" "$h" >/dev/null
  for page in "map / Now,Shot,Sky,Find,Weather,Map,Markers" "viewfinder /viewfinder Now,Shot,Sky,Find,Weather,View,Markers"; do
    read -r label path tabs <<<"$page"
    go "$path?$CAM&t=2026-07-15T22:00Z"
    bad=()
    for t in ${tabs//,/ }; do
      tab "$t"
      r=$(js "$TRUNC")
      [ "$r" != none ] && bad+=("$t: $r")
    done
    check "$label $name: no truncated summaries" "$([ ${#bad[@]} = 0 ] && echo 1 || echo 0)" "${bad[*]:-none}"
  done
done
ab set viewport 1600 1000 >/dev/null
go "/?$CAM&t=2026-07-15T12:00Z"
tab Sky
mw=$(js '(() => { const d = document.querySelector("#ptabpanel details[data-disc=night-milkyway]"); if (!d) return "none"; const s = d.querySelector("summary").textContent.trim(); d.open = true; return `${s}|${!!d.querySelector("[data-mw-reasons]")}`; })()')
check "Sky: MW summary is the verdict, reasons in body" "$(eq "$mw" 'Core not visible now|true')" "$mw"

# 3: Map and View flags are different settings and say so.
go "/?$CAM&t=2026-07-15T22:00Z"
tab Map
m=$(js '[...document.querySelectorAll("#ptabpanel label")].map((l) => l.textContent.trim()).filter((t) => /^(3D buildings|Shadows)/.test(t)).join(" / ")')
check "Map: building/shadow labels say on the map" "$(echo "$m" | grep -c 'on the map.*/.*on the map')" "$m"
go "/viewfinder?$CAM&t=2026-07-15T22:00Z"
tab View
v=$(js '[...document.querySelectorAll("#ptabpanel button[aria-pressed]")].map((b) => b.textContent.trim()).filter((t) => /^(Buildings|Shadows)/.test(t)).join(" / ")')
check "View: building/shadow chips say in view" "$(eq "$v" 'Buildings in view / Shadows in view')" "$v"
rb=$(js '[...document.querySelectorAll("#ptabpanel button, #ptabpanel label")].filter((e) => /rainbow/i.test(e.textContent)).length')
check "View: no rainbow chip (Weather owns it)" "$(eq "$rb" 0)" "$rb"

# 6: weekday chips on one row at 390, full-weekday names, aria-pressed toggles.
ab set viewport 390 844 >/dev/null
go "/?$CAM&t=2026-07-15T22:00Z"
tab Find
js '(() => { document.querySelectorAll("#ptabpanel details").forEach((d) => (d.open = true)); return 1; })()' >/dev/null
sleep 0.3
wd=$(js '(() => { const g = document.querySelector("#ptabpanel [role=group][aria-label=Weekdays]"); if (!g) return "none"; const b = [...g.querySelectorAll("button")]; const r = b.map((x) => x.getBoundingClientRect()); return `${new Set(r.map((x) => Math.round(x.top))).size} ${Math.round(Math.max(...r.map((x) => x.right)))}<=${innerWidth} ${b.map((x) => x.getAttribute("aria-label")).join(",")} ${Math.round(Math.min(...r.map((x) => x.height)))}px`; })()')
fits=$(echo "$wd" | awk '{ split($2, a, "<="); print ($1 == 1 && a[1] <= a[2]) ? 1 : 0 }')
check "Find 390: weekdays on one row" "$fits" "$wd"
check "Find: weekday names are full weekdays" "$(echo "$wd" | grep -c 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday')" "aria-label"
check "Find: weekday chips >= 24 px tall" "$(echo "$wd" | awk '{ print ($4 + 0 >= 24) ? 1 : 0 }')" "${wd##* }"
pr=$(js '(() => { const b = document.querySelector("#ptabpanel [aria-label=Weekdays] button[aria-label=Monday]"); const a0 = b.getAttribute("aria-pressed"); b.click(); return new Promise((ok) => setTimeout(() => { const p = b.getAttribute("aria-pressed"); b.click(); ok(`${a0}->${p}`); }, 100)); })()')
check "Find: weekday chip toggles aria-pressed" "$(eq "$pr" "false->true")" "$pr"
ab screenshot "$OUT/polish-find-390.png" >/dev/null
ab set viewport 1600 1000 >/dev/null

# 7: Open-Meteo answers for the camera only, so every sightline is Unknown: one note per list, no per-row verdicts.
go "/?$CAM&t=2026-07-15T22:00Z"
js "(() => { const f0 = window.fetch; window.fetch = (u, o) => { const s = String(u); if (!s.includes('api.open-meteo.com/v1/forecast')) return f0(u, o); const q = new URL(s).searchParams, lat = q.get('latitude').split(','), lng = q.get('longitude').split(','), vars = q.get('hourly').split(','), p = window.__scape.world.getState().pin; const t0 = Date.parse(q.get('start_date') + 'T00:00:00Z'), t1 = Date.parse(q.get('end_date') + 'T00:00:00Z') + 864e5, time = []; for (let t = t0; t < t1; t += 36e5) time.push(new Date(t).toISOString().slice(0, 16)); const body = lat.map((a, i) => { const here = Math.abs(a - p.lat) < 0.01 && Math.abs(lng[i] - p.lng) < 0.01; return { latitude: +a, longitude: +lng[i], hourly: { time, ...Object.fromEntries(vars.map((v) => [v, time.map(() => (here ? (v === 'visibility' ? 20000 : v === 'weather_code' ? 0 : 10) : null))])) } }; }); return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })); }; window.__scape.settings.getState().update({ weather: true }); const d = new Date(Date.now() + 5 * 864e5); d.setUTCHours(18, 0, 0, 0); window.__scape.world.getState().setTime(d.getTime()); return 'ok'; })()" >/dev/null
tab Weather
wait_for "document.querySelectorAll('#ptabpanel .wx-sight details[data-verdict]').length" 60
wx=$(js '(() => { const c = document.querySelector("#ptabpanel .wx-sight"); if (!c) return "none"; const d = [...c.querySelectorAll("details[data-verdict]")]; return `${d.length} ${d.filter((x) => x.dataset.verdict === "Unknown").length} ${c.querySelectorAll(".sight-unknown").length} ${c.querySelectorAll(".verdict").length}`; })()')
check "Weather sightlines: one horizon-unknown note" "$(echo "$wx" | awk '$1 > 0 && $1 == $2 && $3 == 1 && $4 == 0 { print 1; exit } { print 0 }')" "$wx (rows, unknown, notes, row verdicts)"
tab Now
wait_for "document.querySelector('#ptabpanel .timeline')" 20
nw=$(js '(() => { const p = document.querySelector("#ptabpanel"); return `${p.querySelectorAll(".sight-unknown").length} ${p.querySelectorAll(".timeline [data-sight=Unknown]").length}`; })()')
check "Now timeline: one horizon-unknown note" "$(eq "$nw" '1 0')" "$nw (notes, row verdicts)"
ab screenshot "$OUT/polish-now-unknown.png" >/dev/null

[ "$BRAVE" = 1 ] && brave_stop "$PROFILE" && rm -rf "$PROFILE"

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
