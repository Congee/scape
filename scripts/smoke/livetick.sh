#!/usr/bin/env bash
# Live tick smoke: one minute tick leaves the DateBar inputs in place with no attribute churn, and the time field shows the new minute.
# Usage: scripts/smoke/livetick.sh [port] [cdp-port] [out-dir]
# Needs a dev server on the port; launches a headless Brave on the CDP port unless one answers, and stops only what it started.
set -uo pipefail

PORT=${1:-5480}
CDP=${2:-9480}
OUT=${3:-${TMPDIR:-/tmp}/livetick}
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

W='window.__scape.world.getState()'
# Marks the DateBar inputs and counts every mutation under the bar.
WATCH='(() => {
  const bar = document.querySelector(".datebar");
  bar.querySelectorAll("input").forEach((e) => (e.__tick = 1));
  const m = (window.__tick = { attrs: 0, other: 0, keys: {} });
  new MutationObserver((rs) => {
    for (const r of rs) {
      const k = r.target.nodeName.toLowerCase() + " " + (r.type === "attributes" ? "attr:" + r.attributeName : r.type);
      m.keys[k] = (m.keys[k] ?? 0) + 1;
      if (r.type === "attributes" && r.target.nodeName === "INPUT") m.attrs++;
      else m.other++;
    }
  }).observe(bar, { subtree: true, childList: true, attributes: true, characterData: true });
  return "ok";
})()'
TIME='document.querySelector(".datebar input[type=time]").value'

ab set viewport 1600 1000 >/dev/null
ab open "$BASE/?c=51.9091,4.4868&z=16.5" >/dev/null 2>&1
wait_for '!!window.__scape?.world && !!document.querySelector(".datebar input[type=time]")' 80 || { echo "no DateBar" >&2; FAILS=1; }
js "(() => { const w = $W; w.setTz('UTC'); w.setNow(); return 'ok'; })()" >/dev/null
sleep 0.5
check "clock is live" "$([ "$(js "$W.live")" = true ] && echo 1 || echo 0)" "live=$(js "$W.live")"

# One tick as the clock makes it: a new minute, live untouched.
js "$WATCH" >/dev/null
before=$(js "$TIME")
expect=$(js "(() => { const t = $W.time + 60_000; const d = new Date(t); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); })()")
js "(() => { window.__scape.world.setState({ time: $W.time + 60_000 }); return 'ok'; })()" >/dev/null
sleep 0.5
after=$(js "$TIME")
check "time field shows the new minute" "$([ "$after" = "$expect" ] && echo 1 || echo 0)" "$before → $after (want $expect)"
attrs=$(js 'window.__tick.attrs')
check "no attribute churn on DateBar inputs" "$([ "$attrs" = 0 ] && echo 1 || echo 0)" "$attrs: $(js 'JSON.stringify(window.__tick.keys)')"
kept=$(js '[...document.querySelectorAll(".datebar input")].every((e) => e.__tick === 1)')
check "DateBar inputs not remounted" "$([ "$kept" = true ] && echo 1 || echo 0)" "kept=$kept"
check "no other DateBar mutations" "$([ "$(js 'window.__tick.other')" = 0 ] && echo 1 || echo 0)" "$(js 'window.__tick.other')"

# A user edit still lands, and a cleared field restores on blur.
js "(() => { const e = document.querySelector('.datebar input[type=time]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, '06:30'); e.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()" >/dev/null
sleep 0.3
edited=$(js "new Date($W.time).toISOString().slice(11, 16) + ' ' + $W.live")
check "typed time sets the clock" "$([ "$edited" = "06:30 false" ] && echo 1 || echo 0)" "$edited"
js "(() => { const e = document.querySelector('.datebar input[type=time]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, ''); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); return 'ok'; })()" >/dev/null
sleep 0.3
check "cleared field restores on blur" "$([ "$(js "$TIME")" = 06:30 ] && echo 1 || echo 0)" "$(js "$TIME")"
ab screenshot "$OUT/livetick.png" >/dev/null

[ "$BRAVE" = 1 ] && brave_stop "$PROFILE"

echo "| check | result | detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
[ "$FAILS" = 0 ]
