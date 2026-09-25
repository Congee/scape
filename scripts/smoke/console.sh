#!/usr/bin/env bash
# Console smoke: no warning, error or exception of ours over the main flows, desktop and phone, in Brave and (if its BiDi port is up) Firefox.
# Usage: scripts/smoke/console.sh [dev-port] [cdp] [out-dir] [brave-profile] [firefox-bidi-port]
# Starts what is missing (vite dev, one headless Brave) and stops only what it started; never launches Firefox, which takes focus.
set -uo pipefail

PORT=${1:-5670}
CDP=${2:-9670}
OUT=${3:-${TMPDIR:-/tmp}/console}
PROFILE=${4:-${TMPDIR:-/tmp}/brave-console}
BIDI=${5:-}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
. "$ROOT/scripts/smoke/brave.sh"
mkdir -p "$OUT"
bun "$ROOT/scripts/smoke/models-p3-glb.ts" "$OUT" >/dev/null || exit 1

STARTED=0
if ! curl -s -o /dev/null "http://localhost:$PORT/"; then
  (cd "$ROOT" && bunx vite --port "$PORT" --strictPort >"$OUT/vite-$PORT.log" 2>&1) &
  STARTED=1
fi
LAUNCHED=0
if ! curl -s -o /dev/null "http://localhost:$CDP/json/version"; then
  brave_launch "$CDP" "$PROFILE" || exit 1
  LAUNCHED=1
fi
for p in "$PORT" "$CDP"; do
  for _ in $(seq 120); do curl -s -o /dev/null "http://localhost:$p/" && break; sleep 1; done
done

FAILS=0
ROWS=()
check() { # name, ok (0/1), detail
  local status=PASS
  if [ "$2" != 1 ]; then status=FAIL; FAILS=$((FAILS + 1)); fi
  ROWS+=("| $1 | $status | $3 |")
}
judge() { # browser, log file
  local line
  line=$(grep '^{' "$2" | tail -1)
  if [ -z "$line" ]; then check "$1: flows finished" 0 "no summary, see $2"; return; fi
  while IFS=$'\t' read -r vp ok detail; do check "$1 $vp: every flow ran" "$ok" "$detail"; done < <(bun -e 'const r = JSON.parse(process.argv[1]); for (const [vp, ran] of Object.entries(r.ran)) console.log(`${vp}\t${Object.values(ran).every(Boolean) ? 1 : 0}\t${Object.entries(ran).map(([k, v]) => `${k} ${v ? "ok" : "MISSED"}`).join(", ")}`)' "$line")
  read -r ours distinct total < <(bun -e 'const r = JSON.parse(process.argv[1]); console.log(r.ours, r.distinct, r.total)' "$line")
  check "$1: no console entry of ours" "$([ "$ours" = 0 ] && echo 1 || echo 0)" "$ours ours of $distinct distinct ($total total), list in $2"
}

bun "$ROOT/scripts/smoke/console.ts" "$CDP" "$PORT" "$OUT" >"$OUT/chromium.txt" 2>"$OUT/chromium.err"
judge Brave "$OUT/chromium.txt"
if [ -n "$BIDI" ] && curl -s -o /dev/null "http://127.0.0.1:$BIDI/"; then
  bun "$ROOT/scripts/smoke/console-firefox.ts" "$BIDI" "$PORT" "$OUT" >"$OUT/firefox.txt" 2>"$OUT/firefox.err"
  judge Firefox "$OUT/firefox.txt"
fi

[ "$STARTED" = 1 ] && lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill
[ "$LAUNCHED" = 1 ] && brave_stop "$PROFILE"
echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Output: $OUT"
exit $((FAILS > 0))
