#!/bin/zsh
# timing.sh <cdp> <runs> <outfile> <name:port>... : mesh build ms and per-frame CPU/GPU ms per view, arms rotated per run.
# Run 0 is a warm-up. Hold the GPU timing lock while this runs.
cdp=${1:?cdp}; runs=${2:?runs}; out=${3:?outfile}; shift 3; arms=($@)
(( $#arms )) || { echo "need name:port arms" >&2; exit 2; }
ab() { agent-browser --session ${SESS:-timing} --cdp $cdp "$@"; }
READ='(function(){var s=window.__scape,t=s&&s.terrain.getState();if(!t)return "x";var m=t.mesh;if(!(m.length&&m.length===m[0].levels&&!t.busy.Mesh&&!s.buildings.getState().busy&&s.prism))return "wait";return "done "+Math.round(Math.min.apply(null,m.map(function(x){return x.ms})))+" "+Math.round(Math.max.apply(null,m.map(function(x){return x.ms})))+" "+m.reduce(function(a,x){return a+x.mesh.blocks},0)+" "+m.reduce(function(a,x){return a+x.tiles},0)})()'
# Each update() forces one render; read the stats it left behind.
FRAMES='(async function(){var s=window.__scape,c=s.composition.getState(),raf=function(){return new Promise(function(r){requestAnimationFrame(r)})},cpu=[],gpu=[];for(var i=0;i<'${FRAMES:-40}';i++){var p0=s.prism;c.update({});await raf();await raf();var p=s.prism;if(p&&p!==p0){cpu.push(p.shadow.rasterMs.toFixed(2));gpu.push(p.gpuMs.toFixed(2))}}return "cpu="+cpu.join(",")+" gpu="+gpu.join(",")})()'
for run in $(seq 0 $runs); do
  for t in ${=TIMES:-10:30 16:50 21:00}; do for f in ${=FOCALS:-24 200 600 2400}; do for o in l p; do
    q="camera=46.02070%2C7.74910&target=45.97630%2C7.65860&t=2026-09-26T${t/:/%3A}Z&f=$f&o=$o"
    k=$(( run % $#arms ))
    for a in ${arms[$((k+1)),-1]} ${arms[1,$k]}; do
      n=${a%:*}; p=${a#*:}
      ab open "http://localhost:$p/viewfinder?$q" >/dev/null 2>&1
      st=timeout
      for i in $(seq 1 240); do
        st=$(echo $READ | ab eval --stdin 2>/dev/null | tr -d '"')
        [[ $st == done* ]] && break
        ab wait 250 >/dev/null
      done
      [[ $st == done* ]] || { echo "$run $f$o ${t/:/} $n timeout" >> $out; continue; }
      ab wait 500 >/dev/null
      fr=$(echo $FRAMES | ab eval --stdin 2>/dev/null | tr -d '"')
      echo "$run $f$o ${t/:/} $n ${st#done } $fr" >> $out
    done
  done; done; done
done
echo finished >> $out
