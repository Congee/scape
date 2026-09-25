#!/usr/bin/env bash
# Smoke test for the refined horizon sweep: the refined skyline lands, rise/set is re-timed on it, and the viewfinder shows sun and moon clearing the ridge.
# Usage: scripts/smoke/hzsweep.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port and a browser with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5463}
CDP=${2:-9463}
OUT=${3:-${TMPDIR:-/tmp}/hzsweep}
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

# Zermatt: a deep valley whose skyline delays sunrise by hours.
CAMERA="46.0207,7.7491"
DAY="2026-09-25"
READY='(() => { const t = window.__scape.terrain.getState(); const d = window.__scape.dayData.getState(); return t.horizon?.refined && !t.busy.Horizon && !d.loading && d.key.endsWith("|true"); })()'
# Per terrain event: body, kind, ISO time, and upper limb minus the refined skyline in degrees.
EVENTS='(async () => { const [{ horizonAngleAt }, { position }, { makeObserver, siteHeightM }] = await Promise.all([import("/src/lib/core/terrain/horizon.ts"), import("/src/lib/core/astro/positions.ts"), import("/src/lib/core/astro/bodies.ts")]); const t = window.__scape.terrain.getState(); const w = window.__scape.world.getState(); const obs = makeObserver(w.pin, siteHeightM(t.pinGroundM, w.pinHeightM + 1.6)); return window.__scape.dayData.getState().events.filter((e) => e.kind.startsWith("Terrain") && e.body !== "Gc").map((e) => { const p = position(e.body, new Date(e.time), obs); return `${e.body} ${e.kind} ${new Date(e.time).toISOString()} ${(p.altitude - horizonAngleAt(t.horizon.profile, p.azimuth)).toFixed(4)}`; }).join(";"); })()'

# Sun and moon events of the local day, from a first load.
go "$BASE/viewfinder?camera=$CAMERA&t=${DAY}T10:00:00Z&f=24"
wait_for "$READY" 480
check "refined skyline lands" "$([ "$(js "$READY")" = true ] && echo 1 || echo 0)" "$(js '(() => { const h = window.__scape.terrain.getState().horizon; return h ? `${h.tiles} tiles, peak ${Math.max(...h.profile.angleDeg).toFixed(2)}°` : "none"; })()')"
IFS=';' read -r -a EV <<<"$(js "$EVENTS")"
SUN_RISE=""
MOON_RISE=""
for e in "${EV[@]}"; do
  read -r body kind iso d <<<"$e"
  # Upper limb: minus the semi-diameter (sun 0.262–0.272°, moon 0.245–0.279°).
  ok=$(awk -v d="$d" -v b="$body" 'BEGIN { lo = b == "Sun" ? -0.273 : -0.28; hi = b == "Sun" ? -0.261 : -0.244; print (d >= lo - 0.005 && d <= hi + 0.005) ? 1 : 0 }')
  check "$body $kind timed on the refined skyline" "$ok" "$iso, altitude − skyline ${d}°"
  [ "$body $kind" = "Sun TerrainRise" ] && SUN_RISE=$iso
  [ "$body $kind" = "Moon TerrainRise" ] && MOON_RISE=$iso
done
check "sun and moon clear the terrain today" "$([ -n "$SUN_RISE" ] && [ -n "$MOON_RISE" ] && echo 1 || echo 0)" "sun $SUN_RISE, moon $MOON_RISE"

# The t= link takes whole seconds.
shift_iso() { bun -e "console.log(new Date(Date.parse('$1') + $2 * 60000).toISOString().slice(0, 19) + 'Z')"; }
DAY_T=$(shift_iso "$SUN_RISE" 3)
DAY_BEFORE=$(shift_iso "$SUN_RISE" -6)
NIGHT_T=$(shift_iso "$MOON_RISE" 3)

shot() { # label, body, instant, focal, orientation, expect hidden (true/false)
  local png="$OUT/$1-$2-$4-$5.png"
  go "$BASE/viewfinder?camera=$CAMERA&t=$3&f=$4$([ "$5" = P ] && echo '&o=p')"
  wait_for "$READY" 240
  js "(async () => { const [{ position }, { makeObserver, siteHeightM }] = await Promise.all([import('/src/lib/core/astro/positions.ts'), import('/src/lib/core/astro/bodies.ts')]); const t = window.__scape.terrain.getState(); const w = window.__scape.world.getState(); const p = position('$2', new Date(w.time), makeObserver(w.pin, siteHeightM(t.pinGroundM, w.pinHeightM + 1.6))); window.__scape.composition.getState().aim(p.azimuth, p.altitude); return 'ok'; })()" >/dev/null
  sleep 1
  ab screenshot "$png" >/dev/null
  wait_for "window.__scape.overlay?.bodies?.$2 && Date.now() - window.__scape.overlay.at < 3000" 40
  ab screenshot "$png" >/dev/null
  sleep 0.5
  ab screenshot "$png" >/dev/null
  local got; got=$(js "(() => { const b = window.__scape.overlay?.bodies?.$2; return b ? String(b.hidden) : 'none'; })()")
  local chart; chart=$(js '!!document.querySelector("canvas.chart")')
  check "$1 $2 ${4} mm $5: $([ "$6" = true ] && echo hidden behind the ridge || echo clears the ridge)" "$([ "$got" = "$6" ] && echo 1 || echo 0)" "hidden=$got, chart=$chart, $(basename "$png")"
}

# Village buildings would hide the ridge.
js "(() => { window.__scape.composition.getState().update({ showBuildings: false }); return 'ok'; })()" >/dev/null
ab set viewport 1400 900 >/dev/null
for f in 24 200 600 2400; do
  for o in L P; do
    shot day Sun "$DAY_T" "$f" "$o" false
    shot night Moon "$NIGHT_T" "$f" "$o" false
  done
done
shot before Sun "$DAY_BEFORE" 200 L true

ab set viewport 390 844 >/dev/null
shot phone-day Sun "$DAY_T" 200 P false
shot phone-night Moon "$NIGHT_T" 600 P false
ab set viewport 1400 900 >/dev/null
js "(() => { window.__scape.composition.getState().update({ showBuildings: true }); return 'ok'; })()" >/dev/null

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
