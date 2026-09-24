#!/usr/bin/env bash
# Map pinch-zoom smoke: trackpad pinches in and out over Rotterdam, Manhattan, Zermatt and a plain, with frame pacing and long-task budgets, and a phone viewport that still zooms.
# Usage: scripts/smoke/map-zoom.sh [port] [cdp-port] [agent-browser-session] [screenshot-dir] [brave-profile] [gpu-timing-lock-dir]
# Starts what is missing (vite dev, one background Brave) and stops only what it started.
set -uo pipefail

PORT=${1:-5426}
CDP=${2:-9426}
SESSION=${3:-${AGENT_BROWSER_SESSION:-smoke-$CDP}}
OUT=${4:-${TMPDIR:-/tmp}/map-zoom}
PROFILE=${5:-${TMPDIR:-/tmp}/brave-map-zoom}
LOCK=${6:-${TMPDIR:-/tmp}/gpu-timing.lock}
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
  open -g -n -a "Brave Browser" --args --remote-debugging-port="$CDP" --user-data-dir="$PROFILE" --no-first-run \
    --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling
  BRAVE=1
fi
for u in "$BASE/" "http://localhost:$CDP/json/version"; do
  for _ in $(seq 120); do curl -s -o /dev/null "$u" && break; sleep 1; done
done

ab() { agent-browser --cdp "${CDP:?no CDP port}" --session "$SESSION" "$@"; }

FAILS=0
ROWS=()
check() { # name, ok (0/1), detail
  local status=PASS
  if [ "$2" != 1 ]; then status=FAIL; FAILS=$((FAILS + 1)); fi
  ROWS+=("| $1 | $status | $3 |")
}
ok() { awk "BEGIN { exit !($1) }" && echo 1 || echo 0; }

# Relative to the display's own period (p50), so 60 and 120 Hz both hold; the slack is rAF timestamp jitter, a drop is past 1.5 periods.
P95_OF_PERIOD=1.1
DROPPED_PCT=1
LONG_MS=50

# The driver finds the app's tab by origin; a visible one, since a hidden tab's rAF and input acks stall.
ab open "$BASE/" >/dev/null 2>&1

run() { # scene, layers, viewport
  local out line p50 p95 frames dropped longs worst z0 zmax zmin wide
  out=$(bun "$ROOT/scripts/smoke/map-zoom.ts" "$CDP" "$PORT" "$1" "$2" --runs 1 --viewport "$3" --shot "$OUT/$1-$2-$3.png" 2>&1)
  line=$(grep -m1 '^{' <<<"$out")
  if [ -z "$line" ]; then
    check "$1 $2 $3: measured" 0 "$(grep -m1 -i error <<<"$out")"
    return
  fi
  read -r p50 p95 frames dropped longs worst z0 zmax zmin wide <<<"$(bun -e 'const r = JSON.parse(await Bun.stdin.text()); console.log(r.p50, r.p95, r.frames, r.dropped, r.long.length, Math.max(0, ...r.long), ...r.zoom.slice(0, 3), r.overflow)' <<<"$line")"
  check "$1 $2 $3: p95 ≤ $P95_OF_PERIOD × period, ≤ $DROPPED_PCT% dropped, no long task > $LONG_MS ms, zooms both ways, no sideways scroll" "$([ "$(ok "$p95 > 0 && $p95 <= $P95_OF_PERIOD * $p50 && $dropped * 100 <= $DROPPED_PCT * $frames && $worst <= $LONG_MS && $zmax > $z0 + 1 && $zmin < $z0 - 1")" = 1 ] && [ "$wide" = false ] && echo 1 || echo 0)" "p50 $p50, p95 $p95 ms, $dropped of $frames dropped, $longs long tasks (worst $worst ms), zoom $z0 → $zmax / $zmin, overflow $wide"
}

until mkdir "$LOCK" 2>/dev/null; do sleep 30; done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
for scene in rotterdam manhattan zermatt plain; do run "$scene" default 1400x900; done
# DEM decode and repair are the heaviest per-tile work, and tiles stream in as the pinch crosses zooms.
run zermatt terrain3d 1400x900
run zermatt hillshade 1400x900
run rotterdam default 390x844
rmdir "$LOCK"
trap - EXIT

[ "$VITE" = 1 ] && lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill
[ "$BRAVE" = 1 ] && pgrep -f -- "--user-data-dir=$PROFILE" | xargs -r kill
echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
