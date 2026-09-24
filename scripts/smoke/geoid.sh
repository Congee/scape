#!/usr/bin/env bash
# Geoid smoke: a synthetic GSIGEO2011 file imported through the Offline tab moves Tokyo's PLATEAU heights by exactly its offset from 36.7 m; removing it reverts them; Rotterdam never changes.
# Usage: scripts/smoke/geoid.sh [port] [cdp-port] [screenshot-dir] [brave-profile]
# Starts what is missing (vite dev, one background Brave) and stops only what it started. The grid is synthetic, written to the screenshot dir at runtime.
set -uo pipefail

PORT=${1:-5409}
CDP=${2:-9409}
OUT=${3:-${TMPDIR:-/tmp}/geoid}
PROFILE=${4:-${TMPDIR:-/tmp}/brave-geoid}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BASE="http://localhost:$PORT"
mkdir -p "$OUT"

VITE=0
if ! curl -s -o /dev/null "$BASE/"; then
  (cd "$ROOT" && bunx vite --port "$PORT" --strictPort >"$OUT/vite-$PORT.log" 2>&1) &
  VITE=1
fi
BRAVE=0
if ! curl -s -o /dev/null "http://localhost:$CDP/json/version"; then
  mkdir -p "$PROFILE"
  open -g -j -n -a "Brave Browser" --args --remote-debugging-port="$CDP" --user-data-dir="$PROFILE" --no-first-run \
    --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling
  BRAVE=1
fi
for u in "$BASE/" "http://localhost:$CDP/json/version"; do
  for _ in $(seq 120); do curl -s -o /dev/null "$u" && break; sleep 1; done
done

# Its own agent-browser session: "default" is shared with every other agent.
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
ok() { awk "BEGIN { exit !($1) }" && echo 1 || echo 0; }

# Synthetic grids over central Tokyo: a constant 41.7 m, 5 m above PLATEAU's 36.7 m constant, and an unsupported model.
OFFSET=5
ASC="$OUT/synthetic-geoid.asc"
BAD="$OUT/synthetic-geoid-v1.asc"
(cd "$ROOT" && bun -e "
import { gsiGeoidText } from './src/lib/core/geo/geoidFixture.ts';
const g = { lat0: 35.4, lng0: 139.4, dLat: 1 / 60, dLng: 1.5 / 60, rows: 60, cols: 60 };
await Bun.write('$ASC', gsiGeoidText(g, () => 36.7 + $OFFSET));
await Bun.write('$BAD', gsiGeoidText({ ...g, rows: 2, cols: 2, version: 'ver1.0' }, () => 40));
") || { echo "could not write the synthetic grid" >&2; exit 1; }
gzip -kf "$ASC"

JP_CAM="35.6812,139.7640"
JP_TGT="35.6812,139.7671"
NL_CAM="51.9091,4.4868"
NL_TGT="51.90664,4.48805"
vf_url() { echo "$BASE/viewfinder?camera=$1&target=$2&t=2026-06-21T03:00Z&f=24"; }

wait_for() { # js condition (may be a promise), tries of 0.5 s; each screenshot forces a frame in a background window
  local i
  for ((i = 0; i < ${2:-60}; i++)); do
    [ "$(js "(async () => !!(await ($1)))()")" = true ] && return 0
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
  js '(() => { window.__scape.settings.getState().update({ terrain: true }); window.__scape.composition.getState().update({ showBuildings: true }); return "ok"; })()' >/dev/null
  wait_for "$2" 120 && return 0
  ab reload >/dev/null 2>&1
  wait_for "$2" 120
}

HELPERS='const imp = (p) => import(performance.getEntriesByType("resource").map((e) => e.name).find((n) => new URL(n).pathname === p) ?? p);'
READY='(() => { const p = window.__scape.prism; return p && p.lod2 && !p.lod2.busy && p.lod2.tiles > 0 && !window.__scape.buildings.getState().busy; })()'
# Every drawn tile's geoid flag: "all", "none" or "mixed".
FLAGS="(async () => { $HELPERS const l = await imp('/src/lib/state/lod2.ts'); const t = [...l.lod2Store.getState().tiles.values()]; const g = t.filter((v) => v.geoid).length; return t.length === 0 ? 'empty' : g === t.length ? 'all' : g === 0 ? 'none' : 'mixed'; })()"
settled() { echo "(async () => { const p = window.__scape.prism; if (!p.lod2 || p.lod2.busy || p.lod2.tiles === 0) return false; return (await $FLAGS) === '$1'; })()"; }
# Snapshot every tile's positions in the page, keyed by url.
SNAP="(async () => { $HELPERS const l = await imp('/src/lib/state/lod2.ts'); window.__geoidBase = new Map([...l.lod2Store.getState().tiles].map(([u, t]) => [u, t.mesh.pos.slice()])); return window.__geoidBase.size; })()"
# Up-shift of the tiles now drawn against the snapshot: common tiles, vertices, min and max du, max |de|+|dn|.
DIFF="(async () => { $HELPERS const l = await imp('/src/lib/state/lod2.ts'); let n = 0, v = 0, lo = Infinity, hi = -Infinity, en = 0; for (const [u, t] of l.lod2Store.getState().tiles) { const b = window.__geoidBase.get(u); if (!b || b.length !== t.mesh.pos.length) continue; n++; const p = t.mesh.pos; for (let i = 0; i < p.length; i += 3) { v++; en = Math.max(en, Math.abs(p[i] - b[i]) + Math.abs(p[i + 1] - b[i + 1])); const d = p[i + 2] - b[i + 2]; lo = Math.min(lo, d); hi = Math.max(hi, d); } } return \`\${n} \${v} \${lo.toFixed(5)} \${hi.toFixed(5)} \${en.toFixed(5)}\`; })()"
# Order-independent hash of every drawn tile's positions, for pages that cannot share a snapshot.
HASH="(async () => { $HELPERS const l = await imp('/src/lib/state/lod2.ts'); let h = 0, v = 0; for (const [, t] of [...l.lod2Store.getState().tiles].sort(([a], [b]) => (a < b ? -1 : 1))) { const w = new Uint32Array(t.mesh.pos.buffer, t.mesh.pos.byteOffset, t.mesh.pos.length); for (let i = 0; i < w.length; i++) h = (Math.imul(h, 31) + w[i]) | 0; v += w.length / 3; } return \`\${l.lod2Store.getState().tiles.size} \${v} \${(h >>> 0).toString(16)}\`; })()"
GEOID_META="(async () => { $HELPERS const o = await imp('/src/lib/state/offline.ts'); const g = o.offlineStore.getState().geoid; return g ? \`\${g.version.replaceAll(' ', '_')} \${g.rows}x\${g.cols} \${g.fileName}\` : 'none'; })()"
TEXT_OF() { echo "(() => document.querySelector('$1')?.textContent.trim().replaceAll(' ', '_') ?? 'absent')()"; }
OFFLINE_TAB="(async () => { $HELPERS const u = await imp('/src/lib/state/ui.ts'); u.uiStore.getState().setPanelTab('Offline'); u.uiStore.setState({ panelCollapsed: false }); return 'ok'; })()"
INPUT='input[aria-label="Import the GSI geoid"]'
NO_SIDEWAYS='(() => document.documentElement.scrollWidth <= innerWidth)()'
REMOVE="(() => { window.confirm = () => true; const b = [...document.querySelectorAll('[data-geoid=\"imported\"] button')].find((e) => e.textContent.trim() === 'Remove'); b?.click(); return !!b; })()"

ab set viewport 1400 900 >/dev/null

# Start from no geoid, whatever an earlier run left in this profile.
go "$(vf_url "$JP_CAM" "$JP_TGT")" "$READY"
js "(async () => { $HELPERS const o = await imp('/src/lib/state/offline.ts'); if (o.offlineStore.getState().geoid) await o.offlineStore.getState().removeGeoid(); return 'ok'; })()" >/dev/null

# 1. Rotterdam without a geoid.
go "$(vf_url "$NL_CAM" "$NL_TGT")" "$READY"
read -r nl_tiles nl_verts nl_hash0 <<<"$(js "$HASH")"
nl_flags0=$(js "$FLAGS")

# 2. Tokyo on the 36.7 m constant: the approximate-heights note, no GSI credit.
go "$(vf_url "$JP_CAM" "$JP_TGT")" "$(settled none)"
ab screenshot "$OUT/jp-constant.png" >/dev/null
note=$(js "$(TEXT_OF '[data-geoid-note]')")
credit=$(js "$(TEXT_OF '[data-geoid-credit]')")
check "JP, no geoid: tiles on the constant, note shown, no credit" "$([ "$(js "$FLAGS")" = none ] && [ "$note" != absent ] && [ "$credit" = absent ] && echo 1 || echo 0)" "flags $(js "$FLAGS"); note ${note//_/ }; credit $credit"
base=$(js "$SNAP")

# 3. An unsupported model is refused in the panel.
js "$OFFLINE_TAB" >/dev/null
wait_for "document.querySelector('$INPUT')" 20
ab upload "$INPUT" "$BAD" >/dev/null
wait_for "document.querySelector('p.error')?.textContent.includes('Unsupported')" 40
err=$(js "$(TEXT_OF 'p.error')")
check "Offline: a ver1.0 file is refused" "$([[ $err == *Unsupported* ]] && [ "$(js "$GEOID_META")" = none ] && echo 1 || echo 0)" "${err//_/ }"

# 4. Import the synthetic grid through the file input.
ab upload "$INPUT" "$ASC" >/dev/null
wait_for "document.querySelector('[data-geoid=\"imported\"]')" 60
meta=$(js "$GEOID_META")
status=$(js "$(TEXT_OF '[data-geoid="imported"]')")
ab screenshot "$OUT/offline-imported.png" >/dev/null
check "Offline: import shows the grid's status" "$([[ $meta == *60x60* ]] && [[ $status == *GSIGEO2011* ]] && echo 1 || echo 0)" "store $meta; panel ${status//_/ }"

# 5. Tokyo's tiles re-place on the grid, exactly $OFFSET m lower.
wait_for "$(settled all)" 120
read -r n v lo hi en <<<"$(js "$DIFF")"
check "JP, geoid: every vertex moves by -$OFFSET m" "$(ok "$n > 0 && $n == $base && $lo > -$OFFSET - 0.002 && $hi < -$OFFSET + 0.002 && $en == 0")" "$n of $base tiles, $v vertices, du $lo..$hi, max |de|+|dn| $en"
credit=$(js "$(TEXT_OF '[data-geoid-credit]')")
note=$(js "$(TEXT_OF '[data-geoid-note]')")
ab screenshot "$OUT/jp-geoid.png" >/dev/null
check "JP, geoid: GSI credit shown, note gone" "$([[ $credit == *国土地理院* ]] && [ "$note" = absent ] && echo 1 || echo 0)" "${credit//_/ }"

# 6. A reload reads the grid back from OPFS.
js "$SNAP" >/dev/null
go "$(vf_url "$JP_CAM" "$JP_TGT")" "$(settled all)"
check "JP reload: the stored grid places the tiles" "$([ "$(js "$FLAGS")" = all ] && echo 1 || echo 0)" "flags $(js "$FLAGS"), $(js "$GEOID_META")"

# 7. Rotterdam with the geoid imported: identical meshes, no GSI credit.
go "$(vf_url "$NL_CAM" "$NL_TGT")" "$READY"
read -r nl_tiles1 nl_verts1 nl_hash1 <<<"$(js "$HASH")"
credit=$(js "$(TEXT_OF '[data-geoid-credit]')")
check "NL: meshes identical with and without the geoid" "$([ "$nl_hash0" = "$nl_hash1" ] && [ "$nl_tiles" = "$nl_tiles1" ] && [ "$nl_tiles" -gt 0 ] && echo 1 || echo 0)" "$nl_tiles tiles, $nl_verts vertices, hash $nl_hash0 / $nl_hash1"
check "NL: tiles never flagged geoid, no GSI credit" "$([ "$nl_flags0" = none ] && [ "$(js "$FLAGS")" = none ] && [ "$credit" = absent ] && echo 1 || echo 0)" "flags $nl_flags0 / $(js "$FLAGS"), credit $credit"

# 8. Remove through the panel: Tokyo reverts to the constant.
go "$(vf_url "$JP_CAM" "$JP_TGT")" "$(settled all)"
js "$SNAP" >/dev/null
js "$OFFLINE_TAB" >/dev/null
wait_for "document.querySelector('[data-geoid=\"imported\"]')" 20
js "$REMOVE" >/dev/null
wait_for "document.querySelector('[data-geoid=\"none\"]')" 40
wait_for "$(settled none)" 120
read -r n v lo hi en <<<"$(js "$DIFF")"
note=$(js "$(TEXT_OF '[data-geoid-note]')")
check "JP, removed: every vertex back up by $OFFSET m, note shown" "$([ "$(ok "$n > 0 && $lo > $OFFSET - 0.002 && $hi < $OFFSET + 0.002 && $en == 0")" = 1 ] && [ "$note" != absent ] && echo 1 || echo 0)" "$n tiles, $v vertices, du $lo..$hi; meta $(js "$GEOID_META")"
ab screenshot "$OUT/jp-removed.png" >/dev/null

# 9. Phone: import a gzipped grid and remove it, with no sideways scroll.
ab set viewport 390 844 >/dev/null
js "$OFFLINE_TAB" >/dev/null
wait_for "document.querySelector('$INPUT')" 20
ab screenshot "$OUT/phone-offline-none.png" >/dev/null
none_fit=$(js "$NO_SIDEWAYS")
ab upload "$INPUT" "$ASC.gz" >/dev/null
wait_for "document.querySelector('[data-geoid=\"imported\"]')" 60
ab scrollintoview '[data-geoid="imported"]' >/dev/null 2>&1
ab screenshot "$OUT/phone-offline-imported.png" >/dev/null
check "Phone 390x844: gzip import, no sideways scroll" "$([ "$none_fit" = true ] && [ "$(js "$NO_SIDEWAYS")" = true ] && [[ $(js "$GEOID_META") == *60x60* ]] && echo 1 || echo 0)" "$(js "$GEOID_META"), fits $none_fit / $(js "$NO_SIDEWAYS")"
js "$REMOVE" >/dev/null
wait_for "document.querySelector('[data-geoid=\"none\"]')" 40
check "Phone: remove leaves no geoid" "$([ "$(js "$GEOID_META")" = none ] && echo 1 || echo 0)" "$(js "$GEOID_META")"
ab set viewport 1400 900 >/dev/null

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
rm -f "$OUT/.frame.png" "$ASC" "$ASC.gz" "$BAD"

[ "$VITE" = 1 ] && lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill
[ "$BRAVE" = 1 ] && pgrep -f -- "--user-data-dir=$PROFILE" | xargs -r kill
exit $((FAILS > 0))
