#!/usr/bin/env bash
# Persisted stores smoke: every saved store survives a reload unchanged (no check rejects what the app wrote), a bad field falls back
# to its default while the rest are kept, an old settings version migrates, and unreadable blobs still load the app.
# Usage: scripts/smoke/persisted.sh [port] [cdp-port] [out-dir]
# Needs a dev server on the port; launches a headless Brave on the CDP port unless one answers, and stops only what it started.
set -uo pipefail

PORT=${1:-5476}
CDP=${2:-9476}
OUT=${3:-${TMPDIR:-/tmp}/persisted}
BASE="http://localhost:$PORT"
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
. "$ROOT/scripts/smoke/brave.sh"
mkdir -p "$OUT"
PROFILE="$OUT/brave-profile"
Q='camera=46.5476,7.9806&target=46.5775,8.0053&t=2026-07-15T22:00Z'
STORES='world settings composition gear align finder ui weather'

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
loaded() { wait_for 'window.__scape && document.querySelector("[role=tablist]")' 80; }
go() { ab open "$BASE/?$Q" >/dev/null; loaded; }
reload() { js 'location.reload(), "ok"' >/dev/null; sleep 1; loaded; }
# Each store's persisted fields as JSON, read back through its own partialize.
SNAP="JSON.stringify(Object.fromEntries('$STORES'.split(' ').map((k) => { const s = window.__scape[k]; return [k, JSON.parse(JSON.stringify(s.persist.getOptions().partialize(s.getState())))]; })))"
# Fields whose values differ between two snapshots, as store.field; key order is not a difference.
CANON="((v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x)))"
DIFF="((a, b) => Object.keys(a).flatMap((k) => [...new Set([...Object.keys(a[k]), ...Object.keys(b[k])])].filter((f) => $CANON(a[k][f]) !== $CANON(b[k][f])).map((f) => k + '.' + f)).join(' ') || 'none')"
settings() { js "(() => { const s = window.__scape.settings.getState(); return [$1].join(' '); })()"; }

go
check "app loads" "$( [ "$(js '!!window.__scape')" = true ] && echo 1 || echo 0)" "$BASE"

# Flip every boolean the stores persist, so the reload carries values the app wrote that are not the defaults.
js "(() => { for (const k of '$STORES'.split(' ')) { const s = window.__scape[k]; const p = s.persist.getOptions().partialize(s.getState()); const patch = {}; for (const [f, v] of Object.entries(p)) if (typeof v === 'boolean') patch[f] = !v; s.setState(patch); } return 'ok'; })()" >/dev/null
js "window.__scape.settings.getState().update({ units: 'imperial', coordFormat: 'dms', offlineFlavor: 'dark', goldenAltitude: 8 }), 'ok'" >/dev/null
sleep 0.5
js "sessionStorage.setItem('smoke-snap', $SNAP), 'ok'" >/dev/null
reload
diff=$(js "($DIFF)(JSON.parse(sessionStorage.getItem('smoke-snap')), JSON.parse($SNAP))")
check "every saved field survives a reload" "$([ "$diff" = none ] && echo 1 || echo 0)" "changed: $diff"
check "non-default settings kept" "$([ "$(settings 's.units, s.coordFormat, s.offlineFlavor, s.goldenAltitude')" = 'imperial dms dark 8' ] && echo 1 || echo 0)" "$(settings 's.units, s.coordFormat, s.offlineFlavor, s.goldenAltitude')"

# A bad field falls back to its default; the good fields beside it are kept.
js "(() => { const raw = JSON.parse(localStorage.getItem('scape.settings')); Object.assign(raw.state, { units: 'furlongs', hour12: 'yes', horizonRangeKm: 'far', goldenAltitude: 9, coordFormat: 'dm' }); localStorage.setItem('scape.settings', JSON.stringify(raw)); return 'ok'; })()" >/dev/null
reload
got=$(settings 's.units, s.hour12, s.horizonRangeKm, s.goldenAltitude, s.coordFormat')
check "bad settings fields fall back, good kept" "$([ "$got" = 'metric true 100 9 dm' ] && echo 1 || echo 0)" "units hour12 range golden coords: $got"

# Version 0 stored clickMovesPin; false means a plain click does nothing.
js "localStorage.setItem('scape.settings', JSON.stringify({ state: { clickMovesPin: false, units: 'imperial' }, version: 0 })), 'ok'" >/dev/null
reload
got=$(settings 's.clickMode, s.units')
check "settings v0 migrates" "$([ "$got" = 'off imperial' ] && echo 1 || echo 0)" "clickMode units: $got"

# Unreadable or wrong-shaped blobs in every store: the app still loads, with no page error.
js "(() => { for (const k of '$STORES'.split(' ')) localStorage.setItem('scape.' + k, k === 'world' ? '{not json' : JSON.stringify({ state: k === 'ui' ? 42 : { [k]: [1, 2] }, version: 99 })); return 'ok'; })()" >/dev/null
ab errors --clear >/dev/null 2>&1
reload
up=$(js '!!document.querySelector("[role=tablist]") && !!document.querySelector(".maplibregl-canvas")')
errs=$(ab errors 2>/dev/null | grep -v -e '^$' -e 'No page errors' | head -3 | tr '\n' ' ')
check "garbage in every store still loads" "$([ "$up" = true ] && [ -z "$errs" ] && echo 1 || echo 0)" "tabs+map $up; errors: ${errs:-none}"

js 'localStorage.clear(), sessionStorage.clear(), "ok"' >/dev/null
[ "$BRAVE" = 1 ] && brave_stop "$PROFILE"
echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
exit $((FAILS > 0))
