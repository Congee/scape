#!/usr/bin/env bash
# CSS split smoke: every route and every panel tab on / and /viewfinder, desktop and phone; screenshots plus a computed-style digest.
# With a reference dir from an earlier run, each view must match it pixel for pixel and digest for digest.
# Usage: scripts/smoke/cssplit.sh [port] [cdp-port] [out-dir] [ref-dir]
# Needs a dev server on the port; launches a headless Brave on the CDP port unless one answers, and stops only what it started.
set -uo pipefail

PORT=${1:-5485}
CDP=${2:-9485}
OUT=${3:-${TMPDIR:-/tmp}/cssplit}
REF=${4:-}
BASE="http://localhost:$PORT"
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
. "$ROOT/scripts/smoke/brave.sh"
mkdir -p "$OUT"
PROFILE="$OUT/brave-profile"
Q='camera=46.5476,7.9806&target=46.5775,8.0053&t=2026-07-15T22:00Z'

BRAVE=0
if ! curl -s -o /dev/null "http://localhost:$CDP/json/version"; then
  brave_launch "$CDP" "$PROFILE" || exit 1
  BRAVE=1
  for _ in $(seq 60); do curl -s -o /dev/null "http://localhost:$CDP/json/version" && break; sleep 0.5; done
fi

# Stored map view and panel state would differ between runs.
bun "$ROOT/scripts/smoke/reset.ts" "$CDP" "$BASE"

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

# Canvases are GL pictures CSS never paints; motion is frozen so a frame is repeatable.
STILL="(() => { const s = document.getElementById('cssplit-still') ?? document.head.appendChild(Object.assign(document.createElement('style'), { id: 'cssplit-still' })); s.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }'; document.querySelectorAll('canvas').forEach((c) => { c.style.visibility = 'hidden'; }); document.activeElement?.blur?.(); return 'ok'; })()"
# FNV-1a over every element's and pseudo-element's computed style, minus the inline visibility set above.
DIGEST="(() => { let h = 0x811c9dc5, n = 0; const add = (t) => { for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); } }; for (const e of document.querySelectorAll('body *')) { if (e.closest('canvas')) continue; n++; add(e.tagName + '.' + e.className); for (const p of [null, '::before', '::after']) { const c = getComputedStyle(e, p); for (let i = 0; i < c.length; i++) { const k = c[i]; if (e.tagName === 'CANVAS' && k === 'visibility') continue; add(k + ':' + c.getPropertyValue(k) + ';'); } } } return n + ' ' + (h >>> 0).toString(16); })()"

shot() { # name
  js "$STILL" >/dev/null
  sleep 0.5
  ab screenshot "$OUT/$1.png" >/dev/null
  js "$DIGEST" >"$OUT/$1.digest"
  if [ -n "$REF" ]; then
    local px dg
    px=$(cmp -s "$OUT/$1.png" "$REF/$1.png" && echo same || pxdiff "$OUT/$1.png" "$REF/$1.png")
    dg="$(cat "$OUT/$1.digest") vs $(cat "$REF/$1.digest" 2>/dev/null)"
    check "$1: pixels" "$([ "$px" = same ] && echo 1 || echo 0)" "$px"
    check "$1: computed styles" "$([ "$(cat "$OUT/$1.digest")" = "$(cat "$REF/$1.digest" 2>/dev/null)" ] && echo 1 || echo 0)" "$dg"
  else
    check "$1: captured" "$([ -s "$OUT/$1.png" ] && echo 1 || echo 0)" "$(cat "$OUT/$1.digest")"
  fi
}
pxdiff() { # a b → "same" or the count of differing pixels
  python3 -I - "$1" "$2" <<'PY'
import struct, sys, zlib
def load(path):
    data = open(path, 'rb').read()
    pos, idat = 8, b''
    while pos < len(data):
        n, kind = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        if kind == b'IHDR': w, h, _, ctype = struct.unpack('>IIBB', body[:10])
        elif kind == b'IDAT': idat += body
        pos += 12 + n
    bpp = {2: 3, 6: 4}[ctype]
    raw, stride, rows, prev = zlib.decompress(idat), w * bpp, [], bytearray(w * bpp)
    for y in range(h):
        f, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b, c = prev[i], prev[i - bpp] if i >= bpp else 0
            if f == 1: line[i] = (line[i] + a) & 255
            elif f == 2: line[i] = (line[i] + b) & 255
            elif f == 3: line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(bytes(line)); prev = line
    return w, h, bpp, rows
(w1, h1, b1, r1), (w2, h2, b2, r2) = load(sys.argv[1]), load(sys.argv[2])
if (w1, h1, b1) != (w2, h2, b2): print(f'size {w1}x{h1} vs {w2}x{h2}'); sys.exit()
d = sum(1 for y in range(h1) if r1[y] != r2[y] for x in range(w1) if r1[y][x * b1:(x + 1) * b1] != r2[y][x * b1:(x + 1) * b1])
print('same' if d == 0 else f'{d} px differ')
PY
}

open_page() { # path
  ab open "$BASE$1?$Q" >/dev/null
  wait_for 'window.__scape && document.readyState === "complete"' 80
  sleep 1
}
open_panel() { # path
  open_page "$1"
  wait_for '!!document.querySelector(".panel-inner .tablist")' 80
  js '(() => { document.querySelector(".panel-expand")?.click(); return "ok"; })()' >/dev/null
}
each_tab() { # prefix
  local t tabs
  tabs=$(js '[...document.querySelectorAll(".tablist [role=tab]")].map((t) => t.id.slice(5)).join(" ")')
  [ -n "$tabs" ] || check "$1: tabs found" 0 "none"
  for t in $tabs; do
    js "(() => { document.getElementById('ptab-$t').click(); return 'ok'; })()" >/dev/null
    wait_for "document.getElementById('ptab-$t').getAttribute('aria-selected') === 'true'" 40
    sleep 0.6
    shot "$1-$t"
  done
}

for vp in "desktop 1400 900" "phone 390 844"; do
  read -r name w h <<<"$vp"
  ab set viewport "$w" "$h" >/dev/null
  open_panel /
  each_tab "map-$name"
  open_panel /viewfinder
  each_tab "viewfinder-$name"
  for p in library settings; do
    open_page "/$p"
    shot "$p-$name"
  done
done

[ "$BRAVE" = 1 ] && brave_stop "$PROFILE" && rm -rf "$PROFILE"

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
