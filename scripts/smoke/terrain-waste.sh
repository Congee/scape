#!/bin/zsh
# terrain-waste.sh <port> <cdp> [session] [outdir] : Zermatt → Matterhorn viewfinder, focal × orientation × day/night.
# Passes when the full mesh lands with blocks and the canvas draws terrain; screenshots go to outdir.
port=${1:?port}; cdp=${2:?cdp}; sess=${3:-default}; out=${4:-${TMPDIR:-/tmp}/terrain-waste-smoke}
mkdir -p $out
ab() { agent-browser --session $sess --cdp $cdp "$@"; }
state='(function(){var s=window.__scape;if(!s)return "x";var t=s.terrain.getState(),m=t.mesh,p=s.prism;var done=m.length&&m.length===m[0].levels&&!t.busy.Mesh;return JSON.stringify({done:!!done,err:t.error||null,blocks:m.reduce(function(a,x){return a+x.mesh.blocks},0),drawn:p?p.terrain.blocks:0,canvas:!!document.querySelector("canvas.vf-gl")})})()'
fail=0
printf '%-6s %-2s %-6s %-6s %-6s %s\n' focal o time blocks drawn result
for t in 10:30 21:00; do for f in 24 200 600 2400; do for o in l p; do
  q="camera=46.02070%2C7.74910&target=45.97630%2C7.65860&t=2026-09-26T${t/:/%3A}Z&f=$f&o=$o"
  ab open "http://localhost:$port/viewfinder?$q" >/dev/null
  j=''
  for i in $(seq 1 180); do
    j=$(echo "$state" | ab eval --stdin 2>/dev/null | sed 's/^"//; s/"$//; s/\\"/"/g')
    [[ $j == *'"done":true'* && $j != *'"drawn":0'* ]] && break
    ab wait 500 >/dev/null
  done
  b=$(echo "$j" | jq -r '.blocks // 0' 2>/dev/null); d=$(echo "$j" | jq -r '.drawn // 0' 2>/dev/null)
  ok=$(echo "$j" | jq -r 'if .done and .err == null and .blocks > 0 and .drawn > 0 and .canvas then "pass" else "FAIL" end' 2>/dev/null)
  [[ $ok == pass ]] || { ok=FAIL; fail=1; }
  ab screenshot $out/$f$o-${t/:/}.png >/dev/null
  printf '%-6s %-2s %-6s %-6s %-6s %s\n' $f $o $t ${b:-0} ${d:-0} $ok
done; done; done
exit $fail
