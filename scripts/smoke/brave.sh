# Sourced by smokes. Launches one headless Brave: any windowed launch, even open -g -j, can steal focus.
# Usage: brave_launch <cdp-port> <profile-dir>, then brave_stop <profile-dir>, which kills by profile path only.
# BRAVE_BIN overrides the binary; else the `brave` on PATH (its wrapper execs the app), else the app in /Applications.
brave_bin() {
  if [ -n "${BRAVE_BIN:-}" ]; then echo "$BRAVE_BIN"
  elif command -v brave >/dev/null; then command -v brave
  elif [ -x "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" ]; then echo "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
  else echo "no Brave: set BRAVE_BIN" >&2; return 1
  fi
}
brave_launch() {
  local bin
  bin=$(brave_bin) || return 1
  mkdir -p "$2"
  nohup "$bin" --headless=new --remote-debugging-port="$1" --user-data-dir="$2" --no-first-run \
    --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling about:blank >/dev/null 2>&1 &
}
# Waits for exit, so a following smoke on the same CDP port never adopts a dying browser.
brave_stop() {
  pgrep -f -- "--user-data-dir=$1" | xargs -r kill
  for _ in $(seq 50); do pgrep -f -- "--user-data-dir=$1" >/dev/null || return 0; sleep 0.2; done
  pgrep -f -- "--user-data-dir=$1" | xargs -r kill -9
}
