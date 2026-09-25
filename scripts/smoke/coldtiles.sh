#!/usr/bin/env bash
# Cold-tiles smoke: hidden buildings (or terrain off) fetch and redraw nothing; showing them again loads them.
# Usage: scripts/smoke/coldtiles.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port and a headless browser with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5610}
CDP=${2:-9610}
OUT=${3:-${TMPDIR:-/tmp}/coldtiles}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SESSION=${AGENT_BROWSER_SESSION:-smoke-$CDP}

# The driver reuses the app's tab on this origin.
agent-browser --cdp "$CDP" --session "$SESSION" open "http://localhost:$PORT/" >/dev/null 2>&1
bun "$ROOT/scripts/smoke/coldtiles.ts" "$CDP" "$PORT" "$OUT"
