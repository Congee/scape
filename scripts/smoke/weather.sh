#!/usr/bin/env bash
# Weather smoke: now card, model switch, Timeline cloud row, range and offline states, sightlines and the map cloud layer, desktop and phone.
# Usage: scripts/smoke/weather.sh [port] [cdp-port] [screenshot-dir] [brave-profile] [gpu-timing-lock-dir]
# Needs a dev server on the port and a headless browser with remote debugging on the CDP port; a profile and lock add the idle CPU check.
set -uo pipefail

PORT=${1:-5441}
CDP=${2:-9441}
OUT=${3:-${TMPDIR:-/tmp}/weather}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SESSION=${AGENT_BROWSER_SESSION:-smoke-$CDP}

# The driver reuses the app's tab on this origin.
agent-browser --cdp "$CDP" --session "$SESSION" open "http://localhost:$PORT/" >/dev/null 2>&1
bun "$ROOT/scripts/smoke/weather.ts" "$CDP" "$PORT" "$OUT" "${4:-}" "${5:-}"
