// Frame pacing of the loaded viewfinder: idle, an aim drag, a time scrub and a zoom, each for a few seconds.
/* oxlint-disable no-await-in-loop -- input steps are paced one frame at a time */
// Usage: bun scripts/smoke/lod2-fps.ts <cdp> <dev-port> <scenarios,comma> [seconds] [--profile <out.json>]
// Prints one JSON line per scenario; the page must already show the scene.
import { Tab } from './cdp';

const args = process.argv.slice(2);
const [cdp = '9404', port = '5404', list = 'idle,drag', secs = '3'] = args;
const profileOut = args.includes('--profile') ? args[args.indexOf('--profile') + 1] : null;
const MS = Number(secs) * 1000;

const Scenario = { Idle: 'idle', Drag: 'drag', Scrub: 'scrub', Zoom: 'zoom' } as const;
type Scenario = (typeof Scenario)[keyof typeof Scenario];

const tab = await Tab.open(Number(cdp), `http://localhost:${port}`);

// Frame intervals from an rAF loop of its own, long tasks, and how often the app drew.
const START = `(() => {
  const r = window.__fps = { t: [], long: [], draws: 0, gpu: [], stop: false };
  const tick = (t) => { r.t.push(t); const p = window.__scape.prism; if (p && p.gpuMs !== r.lastGpu) { r.lastGpu = p.gpuMs; r.gpu.push(p.gpuMs); r.pass = p.gpuPass; } if (!r.stop) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  r.obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) r.long.push(Math.round(e.duration)); });
  r.obs.observe({ type: 'longtask' });
  return document.visibilityState;
})()`;
const STOP = `(() => {
  const r = window.__fps; r.stop = true; r.obs.disconnect();
  const d = r.t.slice(1).map((t, i) => t - r.t[i]).sort((a, b) => a - b);
  const q = (p) => d.length ? +d[Math.min(d.length - 1, Math.floor(p * d.length))].toFixed(1) : -1;
  const g = r.gpu.filter((x) => x >= 0).sort((a, b) => a - b);
  const gq = (p) => g.length ? +g[Math.min(g.length - 1, Math.floor(p * g.length))].toFixed(2) : -1;
  return { frames: d.length, p50: q(0.5), p95: q(0.95), max: q(1), over17: d.filter((x) => x > 17.5).length, long: r.long, gpuP50: gq(0.5), gpuP95: gq(0.95), pass: r.pass ?? null, focal: window.__scape.composition.getState().focalMm };
})()`;

const box = await tab.eval<{ x: number; y: number }>('(() => { const r = document.querySelector(".vf-gl").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()');
const mouse = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) => tab.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, ...extra });

async function drive(s: Scenario) {
  const end = performance.now() + MS;
  if (s === Scenario.Idle) return Bun.sleep(MS);
  if (s === Scenario.Drag) {
    await mouse('mousePressed', box.x, box.y, { clickCount: 1 });
    for (let i = 0; performance.now() < end; i++) {
      await mouse('mouseMoved', box.x + 120 * Math.sin(i / 20), box.y + 30 * Math.sin(i / 33));
      await Bun.sleep(16);
    }
    await mouse('mouseReleased', box.x, box.y, { clickCount: 1 });
    return;
  }
  if (s === Scenario.Scrub) {
    for (let i = 0; performance.now() < end; i++) {
      await tab.eval('(() => { const w = window.__scape.world.getState(); w.setTime(w.time + 60000); })()');
      await Bun.sleep(16);
    }
    return;
  }
  // Wheel steps sized to reach 3x the focal length over the run.
  const steps = Math.round(MS / 16);
  const dy = -Math.log(3) / 0.0015 / steps;
  for (let i = 0; i < steps && performance.now() < end; i++) {
    await tab.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: dy });
    await Bun.sleep(16);
  }
}

type Node = { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; hitCount: number; children?: number[] };
function hotspots(profile: { nodes: Node[]; samples: number[]; timeDeltas: number[] }): string[] {
  const self = new Map<string, number>();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  for (const [i, id] of profile.samples.entries()) {
    const f = byId.get(id)!.callFrame;
    const k = `${f.functionName || '(anon)'} ${f.url.replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`;
    self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  }
  return [...self].toSorted((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${v.toFixed(0)}ms ${k}`);
}

for (const s of list.split(',') as Scenario[]) {
  if (profileOut) {
    await tab.send('Profiler.enable');
    await tab.send('Profiler.setSamplingInterval', { interval: 200 });
    await tab.send('Profiler.start');
  }
  const vis = await tab.eval<string>(START);
  await drive(s);
  await Bun.sleep(300);
  const r = await tab.eval<Record<string, unknown>>(STOP);
  let hot: string[] | undefined;
  if (profileOut) {
    const { profile } = (await tab.send('Profiler.stop')) as { profile: Parameters<typeof hotspots>[0] };
    await Bun.write(profileOut.replace(/\.json$/, `-${s}.cpuprofile`), JSON.stringify(profile));
    hot = hotspots(profile);
  }
  console.log(JSON.stringify({ scenario: s, vis, ...r, ...(hot && { hot }) }));
}
tab.close();
