#!/usr/bin/env bash
# UX fixes smoke: Replace import asks first, the on-map notice, search states and keys, DateBar names, disabled buttons.
# Usage: scripts/smoke/uxfix.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port; launches a headless Brave on the CDP port unless one answers, and stops only what it started.
set -uo pipefail

PORT=${1:-5464}
CDP=${2:-9464}
OUT=${3:-${TMPDIR:-/tmp}/uxfix}
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
styled() { wait_for '(() => { const m = window.__scapeMap; return m && m.isStyleLoaded(); })()' "${1:-80}"; sleep 0.3; }
notice() { js '(() => document.querySelector(".map-notice")?.firstChild?.textContent ?? "none")()'; }

ab set viewport 1400 900 >/dev/null

# Replace import: asks with the counts; Cancel keeps the data.
ab open "$BASE/library" >/dev/null
wait_for '!!document.querySelector("label.file.danger input")' 80
off=$(js '(() => { const b = [...document.querySelectorAll("button")].find((x) => x.disabled); return b ? getComputedStyle(b).opacity + " " + getComputedStyle(b).cursor : "none"; })()')
check "disabled button looks disabled" "$(awk -v o="${off% *}" -v c="${off#* }" 'BEGIN { print (o != "none" && o + 0 < 1 && c == "default") ? 1 : 0 }')" "opacity, cursor: $off"
ab fill 'input[placeholder^="Name for"]' 'uxfix spot' >/dev/null
js '(() => { [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save").click(); return "ok"; })()' >/dev/null
wait_for 'document.body.innerText.includes("uxfix spot")' 40
ab screenshot "$OUT/after-library.png" >/dev/null
# The stub answers Cancel, as a real dialog would here.
js '(() => { window.__asked = []; window.confirm = (m) => { window.__asked.push(m); return false; }; const f = new File([JSON.stringify({ format: "scape", version: 1, locations: [], markers: [], plans: [] })], "empty.scape.json", { type: "application/json" }); const dt = new DataTransfer(); dt.items.add(f); const i = document.querySelector("label.file.danger input"); i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true })); return "ok"; })()' >/dev/null
wait_for 'window.__asked.length > 0' 40
asked=$(js 'window.__asked.join(" / ")')
check "Replace asks first, naming the counts" "$([[ "$asked" =~ ^Replace\ [0-9]+\ locations?\ with\ this\ file\?$ ]] && echo 1 || echo 0)" "$asked"
sleep 0.5
ab reload >/dev/null
wait_for '!!document.querySelector("label.file.danger input")' 80
sleep 0.5
kept=$(js 'document.body.innerText.includes("uxfix spot")')
check "Cancel keeps the data" "$([ "$kept" = true ] && echo 1 || echo 0)" "location still saved after reload: $kept"
look=$(js '(() => { const [m, r] = document.querySelectorAll("label.file"); const s = (e) => getComputedStyle(e).borderLeftStyle + " " + getComputedStyle(e.querySelector("strong") ?? e).color; return `${s(m)} | ${s(r)}`; })()')
check "Merge and Replace look different" "$([ "${look% | *}" != "${look#* | }" ] && echo 1 || echo 0)" "$look"

# Map page.
ab open "$BASE/?camera=45.9763,7.6586&z=12&t=2026-06-21T10:00Z" >/dev/null
wait_for 'window.__scape && window.__scapeMap' 80 && styled
js '(() => { window.__scape.settings.getState().update({ basemapId: "ofm-liberty", showSatellite: false }); return "ok"; })()' >/dev/null
styled
n=$(notice)
check "no notice while the map draws" "$([ "$n" = none ] && echo 1 || echo 0)" "$n"

# DateBar names in the a11y tree.
tree=$(ab snapshot 2>/dev/null)
miss=""
for name in "Back one week" "Back one day" "Forward one day" "Forward one week"; do
  grep -q "button \"$name\"" <<<"$tree" || miss+="$name; "
done
check "DateBar buttons have names" "$([ -z "$miss" ] && echo 1 || echo 0)" "${miss:-all four found}"

# Offline: the notice says so; back online, Retry clears it.
bun "$ROOT/scripts/smoke/cdp-offline.ts" "$CDP" "$PORT" >/dev/null 2>&1 &
OFF_PID=$!
wait_for '!navigator.onLine' 40
js '(() => { window.__scapeMap.jumpTo({ center: [12.49, 41.89], zoom: 11 }); return "ok"; })()' >/dev/null
wait_for 'document.querySelector(".map-notice")?.dataset.kind === "Offline"' 40
n=$(notice)
check "offline shows the offline notice" "$([ "$n" = "Offline: showing cached map only" ] && echo 1 || echo 0)" "$n"
raw=$(js 'document.body.innerText.includes("AJAXError")')
check "no raw error text anywhere" "$([ "$raw" = false ] && echo 1 || echo 0)" "AJAXError shown: $raw"
ab screenshot "$OUT/after-offline.png" >/dev/null
sleep 2
kill "$OFF_PID" 2>/dev/null
wait "$OFF_PID" 2>/dev/null
wait_for 'navigator.onLine' 40
sleep 1
after=$(notice)
ab screenshot "$OUT/after-back-online.png" >/dev/null
if [ "$(js '!!document.querySelector(".map-notice button")')" = true ]; then
  js '(() => { document.querySelector(".map-notice button").click(); return "ok"; })()' >/dev/null
fi
wait_for '!document.querySelector(".map-notice")' 80
n=$(notice)
check "back online, the notice clears" "$([ "$n" = none ] && echo 1 || echo 0)" "after reconnect: $after; then: $n"
# A failure that outlives the reconnect: Retry reloads the source and the notice goes.
wait_for 'window.__scapeMap.areTilesLoaded()' 160
js '(() => { window.__scape.mapStatus.getState().setError("AJAXError: Failed to fetch (0)", "openmaptiles"); return "ok"; })()' >/dev/null
wait_for '!!document.querySelector(".map-notice button")' 20
n=$(notice)
check "a stuck tile failure offers Retry" "$([ "$n" = "Map tiles couldn't load" ] && echo 1 || echo 0)" "$n"
ab screenshot "$OUT/after-tiles-failed.png" >/dev/null
seq0=$(js 'window.__scape.mapStatus.getState().retrySeq')
js '(() => { document.querySelector(".map-notice button").click(); return "ok"; })()' >/dev/null
wait_for '!document.querySelector(".map-notice")' 40
wait_for 'window.__scapeMap.areTilesLoaded()' 80
wait_for 'window.__scapeMap.areTilesLoaded()' 160
r=$(js '(() => `${document.querySelector(".map-notice") ? "shown" : "none"} ${window.__scape.mapStatus.getState().retrySeq - '"$seq0"'} ${window.__scapeMap.areTilesLoaded()} ${Object.entries(window.__scapeMap.style.tileManagers).filter(([, c]) => !c.loaded()).map(([k]) => k).join(",")}`)()')
check "Retry clears it and reloads tiles" "$([ "${r% }" = "none 1 true" ] && echo 1 || echo 0)" "notice, retries, tiles loaded: $r"

# Satellite with no key over open ocean.
js '(() => { window.__scape.settings.getState().update({ showSatellite: true }); window.__scapeMap.jumpTo({ center: [-150, 0], zoom: 6 }); return "ok"; })()' >/dev/null
wait_for 'document.querySelector(".map-notice")?.dataset.kind === "NoSatellite"' 40
n=$(notice)
check "satellite gap says a key is needed" "$([ "$n" = "No satellite imagery here without a MapTiler key" ] && echo 1 || echo 0)" "$n"
ab screenshot "$OUT/after-satellite-gap.png" >/dev/null
js '(() => { window.__scapeMap.jumpTo({ center: [7.6586, 45.9763], zoom: 12 }); return "ok"; })()' >/dev/null
wait_for '!document.querySelector(".map-notice")' 40
n=$(notice)
check "satellite notice clears where imagery exists" "$([ "$n" = none ] && echo 1 || echo 0)" "$n"
js '(() => { window.__scape.settings.getState().update({ showSatellite: false }); return "ok"; })()' >/dev/null

# Search: no matches, then ↓↓ Enter picks the second result.
INPUT='input[role=combobox]'
ab fill "$INPUT" 'qzxqzxv wqxzz' >/dev/null
wait_for '[...document.querySelectorAll(".search-status")].some((p) => p.textContent === "No matches")' 60
st=$(js '[...document.querySelectorAll(".search-status")].map((p) => p.textContent).join(" / ") || "none"')
check "nonsense query says No matches" "$([[ "$st" == *"No matches"* ]] && echo 1 || echo 0)" "$st"
ab screenshot "$OUT/after-search-none.png" >/dev/null
ab fill "$INPUT" 'Springfield' >/dev/null
wait_for 'document.querySelectorAll("[role=option]").length >= 2' 60
live=$(js 'document.querySelector(".search [aria-live]").textContent')
ab press ArrowDown >/dev/null
ab press ArrowDown >/dev/null
sel=$(js '(() => { const i = document.querySelector("input[role=combobox]"), o = document.querySelectorAll("[role=option]"); return `${i.getAttribute("aria-expanded")} ${i.getAttribute("aria-activedescendant") === o[1].id} ${o[1].getAttribute("aria-selected")}`; })()')
want=$(js 'document.querySelectorAll("[role=option] .name")[1].textContent')
ab screenshot "$OUT/after-search-keys.png" >/dev/null
js '(() => { window.__pin0 = JSON.stringify(window.__scape.world.getState().pin); return "ok"; })()' >/dev/null
ab press Enter >/dev/null
sleep 0.5
r=$(js '(() => `${JSON.stringify(window.__scape.world.getState().pin) !== window.__pin0} ${document.querySelector("input[role=combobox]").value === ""} ${!document.querySelector("[role=listbox]")}`)()')
check "↓↓ highlights the second result" "$([ "$sel" = "true true true" ] && echo 1 || echo 0)" "expanded, active, selected: $sel ($want)"
check "Enter picks it" "$([ "$r" = "true true true" ] && echo 1 || echo 0)" "pin moved, input cleared, list closed: $r"
check "live region announces the count" "$([[ "$live" =~ ^[0-9]+\ results?$ ]] && echo 1 || echo 0)" "$live"
ab fill "$INPUT" 'Springfield' >/dev/null
wait_for 'document.querySelectorAll("[role=option]").length >= 2' 60
ab press Escape >/dev/null
sleep 0.2
r=$(js 'document.querySelector("input[role=combobox]").getAttribute("aria-expanded")')
check "Esc closes the list" "$([ "$r" = false ] && echo 1 || echo 0)" "aria-expanded $r"
ab press ArrowDown >/dev/null
ab press Tab >/dev/null
sleep 0.4
r=$(js '(() => { const a = document.activeElement; return `${a?.tagName} ${a?.getAttribute("aria-label")}`; })()')
check "Tab reaches the Target button" "$([[ "$r" == "BUTTON Set "*" as the target" ]] && echo 1 || echo 0)" "$r"
js '(() => { window.__scape.world.getState().setPin2(null); window.__pin20 = "null"; return "ok"; })()' >/dev/null
ab press Enter >/dev/null
sleep 0.4
r=$(js 'JSON.stringify(window.__scape.world.getState().pin2) !== window.__pin20')
check "Target button sets the target by keyboard" "$([ "$r" = true ] && echo 1 || echo 0)" "target moved: $r"

[ "$BRAVE" = 1 ] && brave_stop "$PROFILE" && rm -rf "$PROFILE"

echo "| Check | Result | Detail |"
echo "|---|---|---|"
printf '%s\n' "${ROWS[@]}"
echo "Screenshots: $OUT"
exit $((FAILS > 0))
