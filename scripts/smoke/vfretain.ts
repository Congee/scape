// Viewfinder retention smoke: viewfinder → map → viewfinder at the same spot fetches, places and uploads no building again;
// after the camera moves far away on the map the old spot's buildings are let go.
/* oxlint-disable no-await-in-loop -- smoke steps run one after another */
// Usage: bun scripts/smoke/vfretain.ts <cdp> <port>
import { Tab } from './cdp';

const [cdp = '9462', port = '5462'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
// De Rotterdam from the Maas: 3DBAG LoD2 plus Overture prisms.
const CAMERA = '51.9091,4.4868';
const TARGET = '51.90664,4.48805';
const FAR = { lat: 52.3731, lng: 4.8926 };
const BUILDING_URL = /buildings\.pmtiles|3dbag\.nl|swissbuildings3d|plateau/;

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

// Counts building worker answers, viewfinder GL contexts and the bytes uploaded into them.
const HOOK = `(() => {
  const r = { tiles: 0, lod2: 0, contexts: 0, uploadBytes: 0, uploads: 0 };
  window.__vr = r;
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', (e) => { const k = e.data?.kind; if (k === 'Tiles') r.tiles++; else if (k === 'Lod2Tile') r.lod2++; });
    }
  };
  const gc = HTMLCanvasElement.prototype.getContext;
  const seen = new WeakSet();
  HTMLCanvasElement.prototype.getContext = function (type, ...a) {
    const ctx = gc.call(this, type, ...a);
    if (type === 'webgl2' && ctx && this.classList.contains('vf-gl') && !seen.has(ctx)) { seen.add(ctx); r.contexts++; }
    return ctx;
  };
  const P = WebGL2RenderingContext.prototype;
  const count = (name, at) => {
    const f = P[name];
    P[name] = function (...a) {
      const d = a[at];
      if (this.canvas.classList?.contains('vf-gl') && d && ArrayBuffer.isView(d)) { r.uploads++; r.uploadBytes += d.byteLength; }
      return f.apply(this, a);
    };
  };
  count('bufferData', 1);
  count('texSubImage2D', 8);
})()`;

const SETTLED = `(() => {
  const S = window.__scape, t = S.terrain.getState(), p = S.prism;
  return !!p && !t.busy.Mesh && !t.busy.View && t.mesh.length > 0 && !S.buildings.getState().busy && !p.lod2?.busy && S.buildings.getState().tiles.size > 0;
})()`;

const tab = await Tab.open(Number(cdp), BASE);
await tab.send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'service_workers,cache_storage' });
await tab.fresh(BASE);
await tab.viewport(1400, 900, 2);
await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
await tab.send('Performance.enable');

type Counts = { tiles: number; lod2: number; contexts: number; uploadBytes: number; uploads: number };
const counts = () => tab.eval<Counts>('({ ...window.__vr })');
const metric = async (name: string) => ((await tab.send('Performance.getMetrics')) as { metrics: { name: string; value: number }[] }).metrics.find((m) => m.name === name)?.value ?? 0;
const heapMb = async () => {
  await tab.send('HeapProfiler.collectGarbage');
  return +((await metric('JSHeapUsedSize')) / 2 ** 20).toFixed(1);
};
const park = () => tab.eval<{ lat: number; lng: number } | null>('window.__scape.vfPark?.() ?? null');
const settle = async () => {
  const ok = await tab.until(SETTLED, 90_000, 250);
  await Bun.sleep(2000);
  return !!ok && (await tab.eval<boolean>(SETTLED));
};
const clickRail = async (href: string) => {
  await tab.eval(`document.querySelector('a.rail-link[href^="${href}"]').click()`);
  await tab.until(href === '/' ? '!!document.querySelector(".maplibregl-canvas") && !document.querySelector("canvas.vf")' : '!!document.querySelector("canvas.vf")', 30_000, 100);
};
const tileCount = () => tab.eval<{ prisms: number; lod2: number }>('({ prisms: window.__scape.buildings.getState().tiles.size, lod2: window.__scape.lod2?.getState().tiles.size ?? -1 })');

await tab.eval("try { localStorage.removeItem('scape.composition') } catch {}");
await tab.navigate(`${BASE}/viewfinder?camera=${CAMERA}&target=${TARGET}&t=2026-06-21T13:00Z&f=50`);
await tab.until('!!(window.__scape && document.querySelector("canvas.vf"))', 30_000, 250);
check('first visit settles', await settle(), JSON.stringify(await tileCount()));
const first = await counts();

await clickRail('/');
await Bun.sleep(3000);
const onMap = await park();
const held = await tileCount();
console.error(`on the map: parked ${JSON.stringify(onMap)}, stores ${JSON.stringify(held)}, JS heap ${await heapMb()} MB`);
check('map keeps the spot', !!onMap && held.prisms > 0, `parked ${JSON.stringify(onMap)}, stores ${JSON.stringify(held)}`);

// Back to the same spot.
await tab.logRequests();
const task0 = await metric('TaskDuration');
const before = await counts();
const t0 = performance.now();
await clickRail('/viewfinder');
const back = await settle();
const wallMs = Math.round(performance.now() - t0 - 2000);
const taskMs = Math.round(((await metric('TaskDuration')) - task0) * 1000);
tab.stopRequests();
const after = await counts();
const fetched = tab.requests.filter((u) => BUILDING_URL.test(u));
for (const u of fetched.slice(0, 5)) console.error(`  fetched ${u}`);
check('return settles', back, `${wallMs} ms wall, ${taskMs} ms main-thread tasks`);
check('return fetches no building', fetched.length === 0, `${fetched.length} building requests of ${tab.requests.length}`);
check('return places no building', after.tiles === before.tiles && after.lod2 === before.lod2, `${after.tiles - before.tiles} prism tiles, ${after.lod2 - before.lod2} LoD2 tiles sent (first visit ${first.tiles} + ${first.lod2})`);
check('return reuses the GL context', after.contexts === before.contexts, `${after.contexts - before.contexts} new contexts, ${((after.uploadBytes - before.uploadBytes) / 2 ** 20).toFixed(1)} MB in ${after.uploads - before.uploads} uploads (first visit ${(first.uploadBytes / 2 ** 20).toFixed(1)} MB)`);

// Far away on the map: the old spot goes.
await clickRail('/');
await Bun.sleep(1000);
await tab.eval(`window.__scape.world.getState().setPin(${JSON.stringify(FAR)})`);
await Bun.sleep(1000);
const gone = await park();
const left = await tileCount();
console.error(`far away: parked ${JSON.stringify(gone)}, stores ${JSON.stringify(left)}, JS heap ${await heapMb()} MB`);
check('far move releases the spot', gone === null && left.prisms === 0 && left.lod2 <= 0, `parked ${JSON.stringify(gone)}, stores ${JSON.stringify(left)}`);

const c0 = await counts();
await clickRail('/viewfinder');
const far = await settle();
const c1 = await counts();
check('far spot builds afresh', far && c1.contexts === c0.contexts + 1 && c1.tiles > c0.tiles, `${c1.contexts - c0.contexts} new context, ${c1.tiles - c0.tiles} prism tiles`);

tab.close();
console.log('| check | result | detail |\n|---|---|---|');
for (const r of rows) console.log(r);
process.exit(failed ? 1 : 0);
