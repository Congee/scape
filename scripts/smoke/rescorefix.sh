#!/usr/bin/env bash
# Rescore fixes smoke: Tab/Enter on a marker row and an ND row; aria-pressed chips; targets ≥ 24 px at 1600 and ≥ 44 px coarse at 390;
# the tall phone sheet by handle key and drag; one tide and one cloud chart on Weather; no "New moon" above the new-moon threshold.
# Usage: scripts/smoke/rescorefix.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port; launches a headless Brave on the CDP port unless one answers, and stops only what it started.
set -uo pipefail

PORT=${1:-5478}
CDP=${2:-9478}
OUT=${3:-${TMPDIR:-/tmp}/rescorefix}
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
tab() { js "(() => { const u = window.__scape.ui.getState(); u.setPanelTab('$1'); u.setPanelCollapsed(false); u.setPanelTall(false); return 'ok'; })()" >/dev/null; sleep 0.6; }
open_all() { js '(() => { document.querySelectorAll("#ptabpanel details").forEach((d) => (d.open = true)); return 1; })()' >/dev/null; sleep 0.3; }
eq() { [ "$1" = "$2" ] && echo 1 || echo 0; }
# Focus the control before $1 in tab order, so a real Tab lands on $1.
before() { js "(() => { const t = document.querySelector('$1'); if (!t) return 'none'; const f = [...document.querySelectorAll('button, input, select, summary, a[href], [tabindex]')].filter((e) => e.tabIndex >= 0 && !e.disabled && e.checkVisibility()); const i = f.indexOf(t); if (i < 1) return 'first'; f[i - 1].focus(); return 'ok'; })()"; }
on_target() { js "document.activeElement === document.querySelector('$1')"; }

ab set viewport 1600 1000 >/dev/null
go "/?$Q"

# 1: a marker row is a button that Tab reaches and Enter selects.
js "(async () => { const m = window.__scape.markers.getState(); await m.save({ name: 'Rescore smoke', lat: 46.56, lng: 7.99 }); return 1; })()" >/dev/null
tab Markers
wait_for 'document.querySelector("#ptabpanel .marker-row")' 40
ROW='#ptabpanel .marker-row'
js "(() => { window.__scape.markers.getState().select(null); return 1; })()" >/dev/null
b=$(before "$ROW"); ab press Tab >/dev/null
reached=$(on_target "$ROW")
ab press Enter >/dev/null; sleep 0.3
mk=$(js "(() => { const r = document.querySelector('$ROW'); return \`\${r.tagName} \${r.getAttribute('aria-pressed')}\`; })()")
check "marker row: Tab reaches, Enter selects" "$([ "$b" = ok ] && [ "$reached" = true ] && [ "$mk" = 'BUTTON true' ] && echo 1 || echo 0)" "focus $reached, $mk"

# 1: an ND row's button is reached by Tab and Enter picks that filter.
tab Shot
open_all
ND='#ptabpanel .nd-pick:not([aria-pressed=true])'
wait_for "document.querySelector('$ND')" 20
js "(() => { document.querySelector('$ND').id = 'nd-under-test'; return 1; })()" >/dev/null
b=$(before '#nd-under-test'); ab press Tab >/dev/null
reached=$(on_target '#nd-under-test')
ab press Enter >/dev/null; sleep 0.3
nd=$(js "(() => { const b = document.querySelector('#nd-under-test'); return \`\${b.textContent.trim()} \${b.getAttribute('aria-pressed')} \${b.closest('tr').className}\`; })()")
check "ND row: Tab reaches, Enter picks" "$([ "$b" = ok ] && [ "$reached" = true ] && echo "$nd" | grep -q ' true on$' && echo 1 || echo 0)" "focus $reached, $nd"

# 1: focal, kit and star chips expose aria-pressed.
chips=$(js '(() => { const n = (s) => document.querySelectorAll(s).length; return `${n("#ptabpanel .frame .chips button")} ${n("#ptabpanel .frame .chips button[aria-pressed]")}`; })()')
check "Shot: focal/kit chips carry aria-pressed" "$(echo "$chips" | awk '{ print ($1 > 0 && $1 == $2) ? 1 : 0 }')" "$chips (chips, with aria-pressed)"
tab Markers
js "(() => { const m = window.__scape.markers.getState(); m.select(m.markers[0].id); return 1; })()" >/dev/null
sleep 0.4
stars=$(js '(() => { const s = [...document.querySelectorAll("#ptabpanel button[aria-label$=star], #ptabpanel button[aria-label$=stars]")]; return `${s.length} ${s.filter((b) => b.hasAttribute("aria-pressed")).length}`; })()')
check "Markers: star chips carry aria-pressed" "$(echo "$stars" | awk '{ print ($1 == 5 && $2 == 5) ? 1 : 0 }')" "$stars (stars, with aria-pressed)"
js "(async () => { const m = window.__scape.markers.getState(); for (const x of m.markers.filter((x) => x.name === 'Rescore smoke')) await m.remove(x.id); return 1; })()" >/dev/null


# 7: at a thin crescent above the threshold, no panel row says New moon.
mn=$(js "(async () => { const p = await import('/src/lib/core/astro/positions.ts'); let t = Date.parse('2026-07-01T00:00Z'); for (let i = 0; i < 24 * 40; i++, t += 36e5) { const m = p.moonInfo(new Date(t)); if (m.illumination > p.MOON_NEW_MAX && m.illumination < 0.06) { window.__scape.world.getState().setTime(t); return (m.illumination * 100).toFixed(1); } } return 'none'; })()")
bad=()
for t in Now Sky Find; do
  tab "$t"; open_all
  n=$(js '[...document.querySelectorAll("#ptabpanel *")].filter((e) => !e.children.length && /new moon/i.test(e.textContent)).length')
  [ "$n" != 0 ] && bad+=("$t $n")
done
check "Moon: no New moon at ${mn}% lit" "$([ "$mn" != none ] && [ ${#bad[@]} = 0 ] && echo 1 || echo 0)" "${bad[*]:-none}"

# 5: at 390 the sheet handle's ArrowUp reaches the tall state; ArrowDown steps back.
ab set viewport 390 844 >/dev/null
go "/?$Q"
tab Now
h0=$(js 'Math.round(document.querySelector(".panel").getBoundingClientRect().height)')
ab focus '.sheet-handle' >/dev/null
ab press ArrowUp >/dev/null; sleep 0.5
up=$(js '`${document.querySelector(".map-page").classList.contains("panel-tall")} ${Math.round(document.querySelector(".panel").getBoundingClientRect().height)} ${document.querySelector(".sheet-handle").getAttribute("aria-label")}`')
ab screenshot "$OUT/rescorefix-tall-390.png" >/dev/null
ab press ArrowDown >/dev/null; sleep 0.5
dn=$(js 'document.querySelector(".map-page").classList.contains("panel-tall")')
check "390 sheet: handle ArrowUp tall, ArrowDown back" "$(echo "$up $dn" | awk -v h="$h0" '{ print ($1 == "true" && $2 > h && $5 == "false") ? 1 : 0 }')" "open $h0 px, tall $up, after down $dn"
first=$(js 'document.querySelector("#ptabpanel .psec-h")?.textContent')
check "map Now: readout above Aim" "$(eq "$first" Now)" "first heading $first"
ab set viewport 1600 1000 >/dev/null

# 3, 5, 6: target sizes, the drag and Weather charts, through raw CDP for touch emulation and the Open-Meteo stub.
TOUCH=$(bun "$ROOT/scripts/smoke/rescorefix-touch.ts" "$CDP" "$PORT" "$Q" 2>&1)
TOUCH_RC=$?
while IFS= read -r l; do [[ $l == '| '* ]] && ROWS+=("$l"); done <<<"$TOUCH"
if [ "$TOUCH_RC" != 0 ]; then FAILS=$((FAILS + 1)); grep -q '| FAIL |' <<<"$TOUCH" || ROWS+=("| touch | FAIL | ${TOUCH//$'\n'/ } |"); fi

[ "$BRAVE" = 1 ] && brave_stop "$PROFILE" && rm -rf "$PROFILE"

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
