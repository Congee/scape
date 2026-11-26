// Viewfinder zoom rebuild cost: worker build time, wall time to settled, and GC on the terrain worker, over repeated focal changes.
// Usage: bun scripts/smoke/vfzoom.ts <cdp> <port> [cycles] [lock-dir]; holds the timing lock dir while tracing, if given.
/* oxlint-disable no-await-in-loop -- steps run one after another */
import { mkdirSync, rmdirSync } from 'node:fs';
import { Tab } from './cdp';

const [cdp = '9488', port = '5488', cyclesArg = '4', lock = ''] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
const CYCLES = Number(cyclesArg);
// Zermatt, looking at the Matterhorn.
const URL_VF = `${BASE}/viewfinder?camera=46.0207,7.7491&target=45.9763,7.6586&f=200&t=2026-06-21T13:00Z`;

// Sums each mesh request's slowest level (the one that completes it) as the worker reports it.
const HELPERS = `(() => {
  if (window.__vz) return true;
  const S = window.__scape;
  const vz = { builds: new Map() };
  const post = Worker.prototype.postMessage;
  const hooked = new WeakSet();
  Worker.prototype.postMessage = function (msg, ...rest) {
    if (msg && msg.kind === 'Mesh' && !hooked.has(this)) {
      hooked.add(this);
      this.addEventListener('message', (e) => { const d = e.data; if (d?.kind === 'Mesh' && d.result) vz.builds.set(d.id, Math.max(vz.builds.get(d.id) ?? 0, d.result.ms)); });
    }
    return post.call(this, msg, ...rest);
  };
  vz.settled = () => {
    const t = S.terrain.getState(), p = S.prism;
    return !t.busy.Mesh && !t.busy.View && t.mesh.length > 0 && t.mesh.length === t.mesh[0].levels && !!p?.terrain && p.terrain.levels === t.mesh.length;
  };
  window.__vz = vz;
  return true;
})()`;

const tab = await Tab.open(Number(cdp), BASE);
await tab.fresh(BASE);
await tab.viewport(1400, 900, 2);
const traceEvents: { name: string; cat: string; ph: string; tid: number; dur?: number; args?: { name?: string; data?: { url?: string } } }[] = [];
let traceDone: (() => void) | undefined;
tab.listeners.push((method, params) => {
  if (method === 'Tracing.dataCollected') traceEvents.push(...(params.value as typeof traceEvents));
  if (method === 'Tracing.tracingComplete') traceDone?.();
});

await tab.navigate(URL_VF);
await tab.until('!!(window.__scape && document.querySelector("canvas.vf"))', 30_000, 250);
await tab.eval(HELPERS);
await tab.eval('window.__scape.ui.setState({ panelCollapsed: true })');
const settle = async () => {
  const ok = await tab.until('window.__vz.settled()', 120_000, 100);
  await Bun.sleep(1000);
  return !!ok;
};
const focal = (f: number) => tab.eval(`window.__scape.composition.getState().update({ focalMm: ${f} }), 1`);
if (!(await settle())) throw new Error('viewfinder never settled');
// One cycle first, so the pool holds a rebuild's worth as it would after any zoom.
await focal(400);
await settle();
await focal(200);
await settle();

const take = async () => {
  if (!lock) return;
  for (;;) {
    try {
      mkdirSync(lock);
      return;
    } catch {
      await Bun.sleep(30_000);
    }
  }
};
await take();
let walls: number[] = [];
let builds: number[] = [];
try {
  await tab.eval('window.__vz.builds.clear(), 1');
  await tab.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'v8', 'disabled-by-default-v8.gc'] } });
  for (let i = 0; i < CYCLES; i++)
    for (const f of [400, 200]) {
      const t0 = performance.now();
      await focal(f);
      await tab.until('!window.__vz.settled()', 2000, 20);
      await tab.until('window.__vz.settled()', 120_000, 20);
      walls.push(performance.now() - t0);
      await Bun.sleep(1000);
    }
  const traced = new Promise<void>((r) => (traceDone = r));
  await tab.send('Tracing.end');
  await traced;
  builds = await tab.eval<number[]>('[...window.__vz.builds.values()]');
} finally {
  if (lock) rmdirSync(lock);
}
tab.close();

// Terrain worker threads: those that ran its script.
const names = new Map<number, string>();
for (const e of traceEvents) if (e.ph === 'M' && e.name === 'thread_name') names.set(e.tid, e.args?.name ?? '');
const terrainTids = new Set(traceEvents.filter((e) => e.args?.data?.url?.includes('terrain.worker')).map((e) => e.tid));
const isGc = (e: (typeof traceEvents)[number]) => e.ph === 'X' && (e.name === 'MinorGC' || e.name === 'MajorGC');
const gcMs = (pick: (tid: number) => boolean) => traceEvents.filter((e) => isGc(e) && pick(e.tid)).reduce((a, e) => a + (e.dur ?? 0) / 1000, 0);
const gcCount = (pick: (tid: number) => boolean) => traceEvents.filter((e) => isGc(e) && pick(e.tid)).length;
const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
const median = (xs: number[]) => xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const terrain = (t: number) => terrainTids.has(t);
const workers = (t: number) => (names.get(t) ?? '').includes('Worker');
console.log('| measure | value |\n|---|---|');
console.log(`| rebuilds | ${walls.length} (${builds.length} mesh requests answered) |`);
console.log(`| wall to settled, median / mean ms | ${median(walls).toFixed(0)} / ${mean(walls).toFixed(0)} |`);
console.log(`| worker build, median / mean ms | ${median(builds).toFixed(0)} / ${mean(builds).toFixed(0)} |`);
console.log(`| GC on terrain worker, ms (events) | ${gcMs(terrain).toFixed(1)} (${gcCount(terrain)}) |`);
console.log(`| GC on all workers, ms | ${gcMs(workers).toFixed(1)} |`);
console.log(`| GC on main thread, ms | ${gcMs((t) => (names.get(t) ?? '') === 'CrRendererMain').toFixed(1)} |`);
