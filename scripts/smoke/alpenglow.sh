#!/usr/bin/env bash
# Alpenglow smoke: forecast rows, cache reuse, offline, error, fog and privacy states, desktop and phone, plus one live request.
# Usage: scripts/smoke/alpenglow.sh [port] [cdp-port] [screenshot-dir]
# Needs a dev server on the port and a headless browser with remote debugging on the CDP port.
set -uo pipefail

PORT=${1:-5560}
CDP=${2:-9560}
OUT=${3:-${TMPDIR:-/tmp}/alpenglow}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SESSION=${AGENT_BROWSER_SESSION:-smoke-$CDP}

# The driver reuses the app's tab on this origin.
agent-browser --cdp "$CDP" --session "$SESSION" open "http://localhost:$PORT/" >/dev/null 2>&1
bun "$ROOT/scripts/smoke/alpenglow.ts" "$CDP" "$PORT" "$OUT"
