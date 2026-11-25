// DEM cache memory: per-worker decoded tiles, bytes and heap through an Alps session, at peak and at the end.
// Usage: bun scripts/smoke/demmem.ts <cdp> <port> [linger-s]; linger re-reads heaps after the mesh pool's idle release.
/* oxlint-disable no-await-in-loop -- CDP steps are sequential */
import { Tab } from './cdp';

const [cdp = '9486', port = '5486', linger = '0'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
// Zermatt, looking at the Matterhorn.
const CAMERA = { lat: 46.0207, lng: 7.7491 };
const TARGET = { lat: 45.9763, lng: 7.6586 };
// A valley floor north of Zermatt for the light probe.
const PROBE = { lat: 46.0935, lng: 7.7756 };
const MIB = 2 ** 20;

// Names each worker after the state module that spawned it, so CDP sessions can be told apart.
const NAME_WORKERS = `(() => {
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(url, opts = {}) {
      const at = /\\/src\\/lib\\/(?:state|data)\\/(\\w+)\\.ts/.exec(new Error().stack ?? '');
      super(url, opts.name ? opts : { ...opts, name: at ? at[1] : 'other' });
    }
  };
})()`;
const STATS = '({ name: self.name, dem: (self.__scapeDem ?? []).map((c) => c.stats()) })';

type Stats = { tiles: number; nulls: number; maxTiles: number; bytes: number; keys: string[] };
type Heap = { usedSize: number; totalSize: number; backingStorageSize?: number; embedderHeapUsedSize?: number };
type Sample = { name: string; dem: Stats[]; heap: Heap };

const tab = await Tab.open(Number(cdp), BASE);
await tab.fresh(BASE);
await tab.viewport(1400, 900, 2);
await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: NAME_WORKERS });

async function sample(gc = false): Promise<Sample[]> {
  const got = await Promise.all(
    tab.workerSessions().map(async ([s]) => {
      try {
        if (gc) await tab.send('HeapProfiler.collectGarbage', {}, s, 10_000);
        const r = (await tab.send('Runtime.evaluate', { expression: STATS, returnByValue: true }, s, 5_000)) as { result: { value: Omit<Sample, 'heap'> } };
        const heap = (await tab.send('Runtime.getHeapUsage', {}, s, 5_000)) as Heap;
        return Object.assign(r.result.value, { heap });
      } catch {
        return null;
      }
    })
  );
  return got.filter((x): x is Sample => !!x && x.name !== 'other');
}

const peak = new Map<string, Sample>();
let peakTotal: { bytes: number; at: string; all: Sample[] } = { bytes: 0, at: '', all: [] };
let step = 'boot';
let printedHeap = false;
const bytes = (s: Sample) => s.dem.reduce((a, d) => a + d.bytes, 0);
const record = (all: Sample[]) => {
  if (!printedHeap && all.length) {
    console.error('getHeapUsage sample:', JSON.stringify(all[0].heap));
    printedHeap = true;
  }
  for (const s of all) if (bytes(s) >= bytes(peak.get(s.name) ?? s)) peak.set(s.name, s);
  const total = all.reduce((a, s) => a + bytes(s), 0);
  if (total > peakTotal.bytes) peakTotal = { bytes: total, at: step, all };
};
const sampling = { on: true };
const sampler = (async () => {
  while (sampling.on) {
    record(await sample());
    await Bun.sleep(1000);
  }
})();

const js = <T = unknown>(e: string) => tab.eval<T>(e);
const until = (e: string, ms = 120_000) => tab.until(e, ms, 250);
const HORIZON = `(() => { const t = window.__scape.terrain.getState(); return !!t.horizon?.refined && !t.busy.Horizon; })()`;
const VF_SETTLED = `(() => { const S = window.__scape, t = S.terrain.getState(); return !t.busy.Mesh && !t.busy.View && t.mesh.length > 0 && !S.buildings.getState().busy; })()`;
const rail = async (href: string) => {
  await js(`document.querySelector('a.rail-link[href^="${href}"]').click()`);
  await until(href === '/' ? '!!document.querySelector(".maplibregl-canvas") && !document.querySelector("canvas.vf")' : '!!document.querySelector("canvas.vf")', 30_000);
};
const log = (m: string) => console.error(`[${step}] ${m}`);

step = 'load';
await tab.navigate(`${BASE}/?camera=${CAMERA.lat},${CAMERA.lng}&target=${TARGET.lat},${TARGET.lng}&z=12`);
await until('!!(window.__scape && document.querySelector(".maplibregl-canvas"))', 30_000);
log(`horizon ${!!(await until(HORIZON, 180_000))}`);

// East along the Rhône side of the Pennine Alps, 10 × 5 km, pin and map together.
step = 'pan';
const dLng = 5 / (111.32 * Math.cos((CAMERA.lat * Math.PI) / 180));
for (let i = 1; i <= 10; i++) {
  const p = { lat: CAMERA.lat, lng: CAMERA.lng + i * dLng };
  await js(`(() => { window.__scape.world.getState().setPin(${JSON.stringify(p)}); window.__scapeMap.jumpTo({ center: [${p.lng}, ${p.lat}], zoom: 12 }); return 1; })()`);
  await Bun.sleep(1500);
  await until(HORIZON, 60_000);
}
log('done');
await js(`(() => { const w = window.__scape.world.getState(); w.setPin(${JSON.stringify(CAMERA)}); w.setPin2(${JSON.stringify(TARGET)}); window.__scapeMap.jumpTo({ center: [${CAMERA.lng}, ${CAMERA.lat}], zoom: 12 }); return 1; })()`);
await until(HORIZON);

// Viewfinder, then sweep the horizon by walking the target round the camera.
step = 'viewfinder';
await rail('/viewfinder');
log(`settled ${!!(await until(VF_SETTLED))}`);
step = 'sweep';
for (let az = 0; az < 360; az += 45) {
  const r = (az * Math.PI) / 180;
  const t = { lat: CAMERA.lat + (8 / 111.32) * Math.cos(r), lng: CAMERA.lng + (8 / 111.32 / Math.cos((CAMERA.lat * Math.PI) / 180)) * Math.sin(r) };
  await js(`window.__scape.world.getState().setPin2(${JSON.stringify(t)}), 1`);
  await Bun.sleep(1500);
  await until(VF_SETTLED, 60_000);
}
await js(`window.__scape.world.getState().setPin2(${JSON.stringify(TARGET)}), 1`);
await until(VF_SETTLED, 60_000);
log('done');

step = 'map';
await rail('/');
// Light pollution, the Alpenglow card for the target, and the light probe.
step = 'light';
await js(`(() => { const s = window.__scape; s.settings.getState().update({ showLightPollution: true, weather: true }); const u = s.ui.getState(); u.setPanelTab('Weather'); u.setPanelCollapsed(false); return 1; })()`);
await until('!!document.querySelector("details[data-card=alpenglow] > summary[data-glow-toggle]")', 30_000);
await js('document.querySelector("details[data-card=alpenglow] > summary[data-glow-toggle]").click(), 1');
await Bun.sleep(8000);
await js(`window.__scape.lightProbe.getState().setPoint(${JSON.stringify(PROBE)}), 1`);
log(`probe ${!!(await until('(() => { const p = window.__scape.lightProbe.getState(); return p.light || p.error; })()'))}`);
await Bun.sleep(3000);
await js('(() => { window.__scape.lightProbe.getState().setPoint(null); window.__scape.ui.getState().setPanelTab("Plan"); return 1; })()').catch(() => {});
step = 'end';
await Bun.sleep(3000);

sampling.on = false;
await sampler;
const end = await sample(true);
record(end);
await tab.send('HeapProfiler.collectGarbage');
const page = (await tab.send('Runtime.getHeapUsage')) as Heap;
let later: Sample[] = [];
if (Number(linger) > 0) {
  await Bun.sleep(Number(linger) * 1000);
  later = await sample(true);
}
tab.close();

const mb = (n: number) => (n / MIB).toFixed(1);
const heapMb = (h: Heap) => `${mb(h.usedSize)} + ${mb(h.backingStorageSize ?? 0)}`;
const cap = (s: Sample) => s.dem.reduce((a, d) => a + d.maxTiles, 0);
const tiles = (s: Sample) => s.dem.reduce((a, d) => a + d.tiles, 0);
const names = [...new Set([...peak.keys(), ...end.map((s) => s.name)])].toSorted();
console.log('| worker | cap tiles | peak tiles | peak MB | end tiles | end MB | end heap MB (V8 + backing) |\n|---|---|---|---|---|---|---|');
for (const n of names) {
  const p = peak.get(n);
  const e = end.find((s) => s.name === n);
  const c = p ?? e;
  console.log(`| ${n} | ${c && c.dem.length ? cap(c) : '-'} | ${p ? tiles(p) : '-'} | ${p ? mb(bytes(p)) : '-'} | ${e ? tiles(e) : 'gone'} | ${e ? mb(bytes(e)) : '-'} | ${e ? heapMb(e.heap) : '-'} |`);
}
const keysOf = (all: Sample[]) => all.flatMap((s) => s.dem.flatMap((d) => d.keys));
const endKeys = keysOf(end);
const union = new Set(endKeys);
const endBytes = end.reduce((a, s) => a + bytes(s), 0);
const perTile = endKeys.length ? endBytes / endKeys.length : 0;
console.log(`\ncache total: peak ${mb(peakTotal.bytes)} MB (during ${peakTotal.at}), end ${mb(endBytes)} MB`);
console.log(`end: ${endKeys.length} tiles held, ${union.size} distinct; one shared cache would hold ${mb(union.size * perTile)} MB (saves ${mb(endBytes - union.size * perTile)} MB)`);
const peakKeys = keysOf(peakTotal.all);
console.log(`peak: ${peakKeys.length} tiles held, ${new Set(peakKeys).size} distinct`);
const z = new Map<string, number>();
for (const k of endKeys) z.set(k.split('/')[0], (z.get(k.split('/')[0]) ?? 0) + 1);
console.log(`end zooms: ${[...z].toSorted().map(([k, v]) => `z${k}×${v}`).join(' ')}`);
for (const s of end) console.log(`  ${s.name}: ${[...new Set(s.dem.flatMap((d) => d.keys.map((k) => k.split('/')[0])))].toSorted().join(',')}`);
const heapAll = end.reduce((a, s) => a + s.heap.usedSize + (s.heap.backingStorageSize ?? 0), 0);
console.log(`end worker heap total (V8 + backing, all named workers): ${mb(heapAll)} MB`);
console.log(`page (main thread) heap: ${heapMb(page)} MB`);
if (later.length) console.log(`after ${linger} s idle: ${later.map((s) => `${s.name} ${heapMb(s.heap)}`).join('; ')} MB`);
