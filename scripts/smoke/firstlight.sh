#!/usr/bin/env bash
# First-light smoke: light point on a summit uses its ground height and agrees with alpenglow, desktop and phone.
# Usage: scripts/smoke/firstlight.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port and a headless browser with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5570}
CDP=${2:-9570}
OUT=${3:-${TMPDIR:-/tmp}/firstlight}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SESSION=${AGENT_BROWSER_SESSION:-smoke-$CDP}

# The driver reuses the app's tab on this origin.
agent-browser --cdp "$CDP" --session "$SESSION" open "http://localhost:$PORT/" >/dev/null 2>&1
bun "$ROOT/scripts/smoke/firstlight.ts" "$CDP" "$PORT" "$OUT"
