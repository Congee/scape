#!/usr/bin/env bash
# Smoke test for the refined viewfinder sweep: its skyline matches the horizon's, and sun and moon hide exactly until the rise time.
# Usage: scripts/smoke/hzview.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port and a browser with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5468}
CDP=${2:-9468}
OUT=${3:-${TMPDIR:-/tmp}/hzview}
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
READY='(() => { const t = window.__scape.terrain.getState(); const d = window.__scape.dayData.getState(); return t.horizon?.refined && !t.busy.Horizon && t.view?.refined && !t.busy.View && !d.loading && d.key.endsWith("|true"); })()'
# Records each view landing (refined flag, tiles, ms since recording began).
RECORD='(() => { window.__hzv?.stop(); const t0 = performance.now(); const log = []; const stop = window.__scape.terrain.subscribe((s, p) => { if (s.view && s.view !== p.view) log.push({ refined: s.view.refined, tiles: s.view.tiles, ms: Math.round(performance.now() - t0) }); }); window.__hzv = { log, stop }; return "ok"; })()'
LOG='(() => { const l = window.__hzv?.log ?? []; const c = l.findIndex((e) => !e.refined); const r = l.findIndex((e) => e.refined); return l.length === 0 ? "held" : `${c >= 0 && c < r ? "coarse→" : ""}${r >= 0 ? `refined ${l[r].tiles} tiles ${l[r].ms} ms` : "no refined"}`; })()'
# Per terrain event: body, kind, ISO time, and upper limb minus the refined skyline in degrees.
EVENTS='(async () => { const [{ horizonAngleAt }, { position }, { makeObserver, siteHeightM }] = await Promise.all([import("/src/lib/core/terrain/horizon.ts"), import("/src/lib/core/astro/positions.ts"), import("/src/lib/core/astro/bodies.ts")]); const t = window.__scape.terrain.getState(); const w = window.__scape.world.getState(); const obs = makeObserver(w.pin, siteHeightM(t.pinGroundM, w.pinHeightM + 1.6)); return window.__scape.dayData.getState().events.filter((e) => e.kind === "TerrainRise" && (e.body === "Sun" || e.body === "Moon")).map((e) => { const p = position(e.body, new Date(e.time), obs); return `${e.body} ${new Date(e.time).toISOString()} ${(p.altitude - horizonAngleAt(t.horizon.profile, p.azimuth)).toFixed(4)}`; }).join(";"); })()'

go "$BASE/viewfinder?camera=$CAMERA&t=${DAY}T10:00:00Z&f=24"
wait_for "$READY" 480
check "refined view lands" "$([ "$(js "$READY")" = true ] && echo 1 || echo 0)" "$(js '(() => { const v = window.__scape.terrain.getState().view; return v ? `${v.tiles} tiles, ${v.profile.nAz} columns, missing ${v.missing}` : "none"; })()')"
IFS=';' read -r -a EV <<<"$(js "$EVENTS")"
SUN_RISE=""
MOON_RISE=""
for e in "${EV[@]}"; do
  read -r body iso d <<<"$e"
  [ "$body" = Sun ] && SUN_RISE=$iso
  [ "$body" = Moon ] && MOON_RISE=$iso
done
check "sun and moon rise over terrain today" "$([ -n "$SUN_RISE" ] && [ -n "$MOON_RISE" ] && echo 1 || echo 0)" "sun $SUN_RISE, moon $MOON_RISE"

# The t= link takes whole seconds.
shift_iso() { bun -e "console.log(new Date(Date.parse('$1') + $2 * 1000).toISOString().slice(0, 19) + 'Z')"; }

shot() { # label, body, instant, focal, orientation, expect hidden (true/false)
  local png="$OUT/$1-$2-$4-$5.png"
  go "$BASE/viewfinder?camera=$CAMERA&t=$3&f=$4$([ "$5" = P ] && echo '&o=p')"
  wait_for "$READY" 240
  js "$RECORD" >/dev/null
  js "(async () => { const [{ position }, { makeObserver, siteHeightM }] = await Promise.all([import('/src/lib/core/astro/positions.ts'), import('/src/lib/core/astro/bodies.ts')]); const t = window.__scape.terrain.getState(); const w = window.__scape.world.getState(); const p = position('$2', new Date(w.time), makeObserver(w.pin, siteHeightM(t.pinGroundM, w.pinHeightM + 1.6))); window.__scape.composition.getState().aim(p.azimuth, p.altitude); return 'ok'; })()" >/dev/null
  sleep 1
  wait_for "$READY" 240
  wait_for "window.__scape.overlay?.bodies?.$2 && Date.now() - window.__scape.overlay.at < 3000" 40
  sleep 0.5
  ab screenshot "$png" >/dev/null
  # Body altitude minus the viewfinder's skyline, and the viewfinder's skyline minus the horizon's, at the body.
  local gap; gap=$(js "(async () => { const [{ position }, { makeObserver, siteHeightM }, { horizonAngleAt }, { columnAt }] = await Promise.all([import('/src/lib/core/astro/positions.ts'), import('/src/lib/core/astro/bodies.ts'), import('/src/lib/core/terrain/horizon.ts'), import('/src/lib/core/terrain/view.ts')]); const t = window.__scape.terrain.getState(); const w = window.__scape.world.getState(); const p = position('$2', new Date(w.time), makeObserver(w.pin, siteHeightM(t.pinGroundM, w.pinHeightM + 1.6))); const v = t.view.profile; const c = columnAt(v, p.azimuth); if (c < 0) return 'off 0'; return (p.altitude - v.skylineDeg[c]).toFixed(3) + ' ' + (v.skylineDeg[c] - horizonAngleAt(t.horizon.profile, p.azimuth)).toFixed(3); })()")
  read -r above dsky <<<"$gap"
  local got; got=$(js "(() => { const b = window.__scape.overlay?.bodies?.$2; return b ? String(b.hidden) : 'none'; })()")
  local ok; ok=$(awk -v s="$dsky" -v h="$got" -v e="$6" 'BEGIN { print (h == e) ? 1 : 0 }')
  check "$1 $2 ${4} mm $5: $([ "$6" = true ] && echo hidden behind the ridge || echo clears the ridge)" "$ok" "hidden=$got, alt−view sky ${above}°, view−horizon sky ${dsky}°, $(js "$LOG"), $(basename "$png")"
}

# Village buildings would hide the ridge.
js "(() => { window.__scape.composition.getState().update({ showBuildings: false }); return 'ok'; })()" >/dev/null
ab set viewport 1400 900 >/dev/null
DAY_T=$(shift_iso "$SUN_RISE" 60)
NIGHT_T=$(shift_iso "$MOON_RISE" 60)
for f in 24 200 600 2400; do
  for o in L P; do
    shot day Sun "$DAY_T" "$f" "$o" false
    shot night Moon "$NIGHT_T" "$f" "$o" false
  done
done
# The mark flips at the rise time: hidden half a minute before, shown half a minute after.
for b in Sun Moon; do
  rise=$([ "$b" = Sun ] && echo "$SUN_RISE" || echo "$MOON_RISE")
  shot rise-30s "$b" "$(shift_iso "$rise" -30)" 600 L true
  shot rise+30s "$b" "$(shift_iso "$rise" 30)" 600 L false
  # Seconds from the rise time until the upper limb clears the viewfinder's skyline.
  flip=$(js "(async () => { const [{ position }, { makeObserver, siteHeightM }, { horizonAngleAt }, { columnAt }] = await Promise.all([import('/src/lib/core/astro/positions.ts'), import('/src/lib/core/astro/bodies.ts'), import('/src/lib/core/terrain/horizon.ts'), import('/src/lib/core/terrain/view.ts')]); const t = window.__scape.terrain.getState(); const w = window.__scape.world.getState(); const obs = makeObserver(w.pin, siteHeightM(t.pinGroundM, w.pinHeightM + 1.6)); const v = t.view.profile; return window.__scape.dayData.getState().events.filter((e) => e.kind === 'TerrainRise' && e.body === '$b').map((e) => { const r = position(e.body, new Date(e.time), obs); const limb = r.altitude - horizonAngleAt(t.horizon.profile, r.azimuth); const up = (s) => { const p = position(e.body, new Date(e.time + s * 1000), obs); const c = columnAt(v, p.azimuth); return c >= 0 && p.altitude - v.skylineDeg[c] >= limb; }; let lo = -300, hi = 300; if (up(lo) || !up(hi)) return 'none'; while (hi - lo > 0.5) { const m = (lo + hi) / 2; if (up(m)) hi = m; else lo = m; } return hi.toFixed(1); })[0] ?? 'none'; })()")
  check "$b mark flips at the rise time" "$(awk -v f="$flip" 'BEGIN { print (f != "none" && f >= -15 && f <= 15) ? 1 : 0 }')" "flip − rise ${flip} s"
done

# Idle once refined: no animation frames.
js "(() => { window.__hzf = 0; const raf = window.requestAnimationFrame; window.requestAnimationFrame = (f) => { window.__hzf++; return raf(f); }; return 'ok'; })()" >/dev/null
sleep 3
FR=$(js 'window.__hzf')
check "idle after refinement" "$([ "$FR" = 0 ] && echo 1 || echo 0)" "$FR frames in 3 s"

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
