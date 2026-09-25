#!/usr/bin/env bash
# LoD2 smoke: 3DBAG tiles replace Overture prisms in Rotterdam, in the picture, the occluder, the shadows and the credits; lod2-badtile.ts a bad tile in the mask; lod2-draco.ts covers Zürich, Tokyo and the Draco decoder's reach.
# Usage: scripts/smoke/lod2.sh [port] [cdp-port] [screenshot-dir] [brave-profile] [gpu-timing-lock-dir]
# Starts what is missing (vite dev, one background Brave) and stops only what it started.
set -uo pipefail

PORT=${1:-5402}
CDP=${2:-9402}
OUT=${3:-${TMPDIR:-/tmp}/lod2}
PROFILE=${4:-${TMPDIR:-/tmp}/brave-lod2}
LOCK=${5:-${TMPDIR:-/tmp}/gpu-timing.lock}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BASE="http://localhost:$PORT"
PNG="$ROOT/scripts/smoke/png-sample.py"
mkdir -p "$OUT"

VITE=0
if ! curl -s -o /dev/null "$BASE/"; then
  (cd "$ROOT" && bunx vite --port "$PORT" --strictPort >"$OUT/vite-$PORT.log" 2>&1) &
  VITE=1
fi
BRAVE=0
if ! curl -s -o /dev/null "http://localhost:$CDP/json/version"; then
  mkdir -p "$PROFILE"
  # Headless only: any windowed launch, even open -g -j, can steal focus.
  nohup "${BRAVE_BIN:-/nix/store/4fripln844kh7xfjfh803hr2nm235v4x-brave-1.94.121/Applications/Brave Browser.app/Contents/MacOS/Brave Browser}" --headless=new \
    --remote-debugging-port="$CDP" --user-data-dir="$PROFILE" --no-first-run \
    --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling about:blank >/dev/null 2>&1 &
  BRAVE=1
fi
for u in "$BASE/" "http://localhost:$CDP/json/version"; do
  for _ in $(seq 120); do curl -s -o /dev/null "$u" && break; sleep 1; done
done

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
ok() { awk "BEGIN { exit !($1) }" && echo 1 || echo 0; }

# On the Erasmusbrug, facing De Rotterdam.
NL_CAM="51.9091,4.4868"
NL_TGT="51.90664,4.48805"
DE_ROTTERDAM="{ lat: 51.9066, lng: 4.4880 }"
DAY="2026-06-21T13:00Z"
# Sun and the first-quarter moon both down.
NIGHT="2026-06-21T23:45Z"

wait_for() { # js condition, tries of 0.5 s; each screenshot forces a frame in a background window
  local i
  for ((i = 0; i < ${2:-60}; i++)); do
    [ "$(js "!!($1)")" = true ] && return 0
    ab screenshot "$OUT/.frame.png" >/dev/null 2>&1
    sleep 0.5
  done
  return 1
}

go() { # url, ready condition
  local i
  for i in 1 2 3; do
    ab open "$1" >/dev/null 2>&1 && wait_for 'window.__scape' 40 && break
    sleep 1
  done
  js '(() => { window.__scape.settings.getState().update({ terrain: true, showSunShadows: true, lightSource: "Auto" }); window.__scape.composition.getState().update({ showBuildings: true }); return "ok"; })()' >/dev/null
  wait_for "$2" 120 && return 0
  # A cold dev server can hand the worker a stale pre-bundle; one reload clears it.
  ab reload >/dev/null 2>&1
  wait_for "$2" 120
}

# Page helpers: the modules the app loaded (with any HMR stamp), so the stores are the app's own.
HELPERS='const imp = (p) => import(performance.getEntriesByType("resource").map((e) => e.name).find((n) => new URL(n).pathname === p) ?? p);'
READY='(() => { const p = window.__scape.prism; return p && p.lod2 && !p.lod2.busy && p.lod2.tiles > 0 && p.modelTris > 0 && !window.__scape.buildings.getState().busy; })()'
STATS='(() => { const p = window.__scape.prism; const l = p.lod2; const credit = [...document.querySelectorAll("[data-lod2]")].map((e) => e.textContent.trim()).join("|") || "none"; return `${l.tiles} ${l.tris} ${l.hiddenRows} ${l.missing} ${p.buildings} ${p.modelTris} ${p.shadow.on} ${p.shadow.light} ${p.shadow.casterModelTris} ${l.error ?? "-"} ${credit.replaceAll(" ", "_")}`; })()'
# Overture rows under the De Rotterdam pin, and how many of them the drawn LoD2 rings leave.
UNDER="(async () => { $HELPERS const [b, l, t] = await Promise.all([\"/src/lib/state/buildings.ts\", \"/src/lib/state/lod2.ts\", \"/src/lib/core/geo/buildingTiles.ts\"].map(imp)); const rows = await b.buildingRowsAt($DE_ROTTERDAM); const rings = [...l.lod2Store.getState().tiles.values()].flatMap((v) => v.rings); return rows ? \`\${rows.count} \${t.suppressRows(rows, rings).count}\` : '0 0'; })()"

spread() { # screenshot → picture spread inside the viewfinder canvas
  local box; box=$(js '(() => { const c = document.querySelector("canvas"); const r = c.getBoundingClientRect(); return `${devicePixelRatio} ${r.left + 4} ${r.top + 4} ${r.right - 4} ${r.bottom - 4}`; })()')
  # shellcheck disable=SC2086
  python3 "$PNG" spread "$1" $box
}

vf_url() { # camera, target, instant, focal, orientation
  echo "$BASE/viewfinder?camera=$1&target=$2&t=$3&f=$4$([ "$5" = P ] && echo '&o=p')"
}

ab set viewport 1400 900 >/dev/null

# 1. Rotterdam by day: LoD2 drawn, Overture rows under it gone, shadows cast.
go "$(vf_url "$NL_CAM" "$NL_TGT" "$DAY" 24 L)" "$READY"
ab screenshot "$OUT/nl-day-24-L.png" >/dev/null
read -r tiles tris hidden missing prisms mtris shadow light casters err credit <<<"$(js "$STATS")"
check "NL day: LoD2 tiles drawn" "$(ok "$tiles > 0 && $tris > 0 && $mtris > 0 && $missing == 0")" "$tiles tiles, $tris tris kept, $mtris drawn, $missing missing, error $err"
check "NL day: Overture rows under LoD2 hidden" "$(ok "$hidden > 0 && $prisms > 0")" "$hidden rows hidden, $prisms prisms still drawn"
read -r under left <<<"$(js "$UNDER")"
check "NL: no Overture prism left under De Rotterdam (no z-fight)" "$(ok "$under > 0 && $left == 0")" "$under Overture rows at the pin, $left not covered by LoD2"
check "NL day: shadows on, LoD2 casts" "$([ "$shadow" = true ] && [ "$light" = Sun ] && [ "$casters" -gt 0 ] && echo 1 || echo 0)" "on $shadow, light $light, $casters model/LoD2 caster tris"
check "NL: 3DBAG credit in the viewfinder tools" "$([[ $credit == *3DBAG* ]] && echo 1 || echo 0)" "${credit//_/ }"

# 2. Rotterdam at night: LoD2 still drawn, no shadows.
go "$(vf_url "$NL_CAM" "$NL_TGT" "$NIGHT" 24 L)" "$READY"
ab screenshot "$OUT/nl-night-24-L.png" >/dev/null
read -r tiles tris hidden _ _ _ shadow light _ _ _ <<<"$(js "$STATS")"
check "NL night: LoD2 drawn, no shadows" "$([ "$(ok "$tiles > 0 && $hidden > 0")" = 1 ] && [ "$shadow" = false ] && echo 1 || echo 0)" "$tiles tiles, $hidden hidden; shadows $shadow, light $light"

# 3. The matrix.
for f in 24 200 600 2400; do
  for o in L P; do
    for t in day night; do
      instant=$([ $t = day ] && echo "$DAY" || echo "$NIGHT")
      shot="$OUT/nl-$t-$f-$o.png"
      go "$(vf_url "$NL_CAM" "$NL_TGT" "$instant" "$f" "$o")" "$READY"
      ab screenshot "$shot" >/dev/null
      ab screenshot "$shot" >/dev/null
      read -r tiles tris hidden _ _ mtris shadow _ _ _ _ <<<"$(js "$STATS")"
      want=$([ $t = day ] && echo true || echo false)
      s=$(spread "$shot")
      check "matrix $f mm $o $t" "$([ "$(ok "$tiles > 0 && $mtris > 0 && $hidden > 0 && $s > 2")" = 1 ] && [ "$shadow" = "$want" ] && echo 1 || echo 0)" "$tiles tiles, $mtris LoD2 tris drawn, $hidden hidden, shadows $shadow, spread $s"
    done
  done
done

# 4. Phone.
ab set viewport 390 844 >/dev/null
go "$(vf_url "$NL_CAM" "$NL_TGT" "$DAY" 200 P)" "$READY"
ab screenshot "$OUT/phone-nl-200-P.png" >/dev/null
read -r tiles _ hidden _ _ mtris shadow _ _ _ credit <<<"$(js "$STATS")"
wide=$(js 'document.documentElement.scrollWidth > window.innerWidth')
check "phone 390×844: LoD2 drawn, credit shown, no sideways scroll" "$([ "$(ok "$tiles > 0 && $mtris > 0 && $hidden > 0")" = 1 ] && [[ $credit == *3DBAG* ]] && [ "$wide" = false ] && echo 1 || echo 0)" "$tiles tiles, $mtris tris, shadows $shadow, overflow $wide"
ab set viewport 1400 900 >/dev/null

# 5. Map: the shadow mask stamps LoD2 and carries its credit.
map_credit() { # camera, target, tag
  ab open "$BASE/?camera=$1&target=$2&t=$DAY&z=16.5" >/dev/null 2>&1
  wait_for 'window.__scapeMap && window.__scape.buildings.getState().shadowMask && window.__scapeMap.getLayoutProperty("sun-shadow", "visibility") === "visible"' 120
  wait_for '!window.__scape.buildings.getState().busy' 60
  sleep 1
  ab screenshot "$OUT/map-$3.png" >/dev/null
  js '(() => { const m = window.__scape.buildings.getState().shadowMask; const a = document.querySelector(".maplibregl-ctrl-attrib-inner")?.textContent ?? ""; return `${m ? m.lod2.length : -1} ${a.includes("3DBAG")}`; })()'
}
read -r n credit <<<"$(map_credit "$NL_CAM" "$NL_TGT" nl)"
check "map NL: mask uses LoD2, 3DBAG credited" "$([ "$n" -gt 0 ] && [ "$credit" = true ] && echo 1 || echo 0)" "$n LoD2 sources in the mask, credit $credit"

# 6. Zürich, Tokyo and the Draco decoder, in the smoke's own CDP tab.
DRACO=$(bun "$ROOT/scripts/smoke/lod2-draco.ts" "$CDP" "$PORT" "$OUT")
DRACO_RC=$?
mapfile -t DRACO_ROWS <<<"$DRACO"
ROWS+=("${DRACO_ROWS[@]}")
[ "$DRACO_RC" = 0 ] || FAILS=$((FAILS + 1))

# 6b. A bad tile in the shadow mask warns once and is not refetched.
BAD=$(bun "$ROOT/scripts/smoke/lod2-badtile.ts" "$CDP" "$PORT" "$OUT" 2>"$OUT/badtile.err")
BAD_RC=$?
mapfile -t BAD_ROWS <<<"$BAD"
ROWS+=("${BAD_ROWS[@]}")
[ "$BAD_RC" = 0 ] || FAILS=$((FAILS + 1))

# 7. Frame pacing by day, holding the shared GPU timing lock; a background window must not be throttled.
FPS_BUDGET_MS=17.5
# Hidden tabs pace frames by a 16 ms worker timer, so judge the GPU: M1 Max measured 8.1–10.5 ms p95; 12 ms leaves the 60 Hz frame ~4.7 ms for the page.
FPS_GPU_BUDGET_MS=12
until mkdir "$LOCK" 2>/dev/null; do sleep 30; done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
for f in 200 2400; do
  ab eval '(() => { window.__scape.settings.getState().update({ terrain: true, showSunShadows: true, lightSource: "Auto" }); window.__scape.composition.getState().update({ showBuildings: true }); return "ok"; })()' >/dev/null
  # lod2-fps loads the scene itself so the hidden-tab rAF shim is in before the app starts.
  FPS_OUT=$(bun "$ROOT/scripts/smoke/lod2-fps.ts" "$CDP" "$PORT" idle,drag 3 --url "$(vf_url "$NL_CAM" "$NL_TGT" "$DAY" "$f" L)" --ready "$READY" 2>"$OUT/fps-$f.err")
  FPS_RC=$?
  got=0
  while read -r line; do
    [ -z "$line" ] && continue
    got=$((got + 1))
    read -r sc vis p50 p95 long gpu <<<"$(echo "$line" | bun -e 'const r = JSON.parse(await Bun.stdin.text()); console.log(r.scenario, r.vis, r.p50, r.p95, r.long.length, r.gpuP95)')"
    if [ "$vis" = visible ]; then
      check "fps $f mm day $sc: p95 ≤ $FPS_BUDGET_MS ms" "$(ok "$p95 <= $FPS_BUDGET_MS")" "p50 $p50 ms, p95 $p95 ms, $long long tasks, GPU p95 $gpu ms, tab $vis"
    else
      check "fps $f mm day $sc (tab hidden): 0 long tasks, GPU p95 ≤ $FPS_GPU_BUDGET_MS ms" "$(ok "$long == 0 && $gpu > 0 && $gpu <= $FPS_GPU_BUDGET_MS")" "$long long tasks, GPU p95 $gpu ms; frame p50 $p50 ms, p95 $p95 ms (timer-paced, not judged)"
    fi
  done <<<"$FPS_OUT"
  [ "$FPS_RC" = 0 ] || check "fps $f mm day: measured" 0 "$(grep -m1 -io 'error: .*' "$OUT/fps-$f.err" || echo "lod2-fps exited $FPS_RC")"
done
rmdir "$LOCK"
trap - EXIT

rm -f "$OUT/.frame.png"
[ "$VITE" = 1 ] && lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill
[ "$BRAVE" = 1 ] && pgrep -f -- "--user-data-dir=$PROFILE" | xargs -r kill
echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
