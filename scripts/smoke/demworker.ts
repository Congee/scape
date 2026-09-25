// scape-dem:// protocol path (no WebCodecs): main-thread time per tile, then terrain renders on desktop and phone, and idles.
/* oxlint-disable no-await-in-loop -- CDP steps are sequential */
// Usage: bun scripts/smoke/demworker.ts <cdp> <port> [screenshot-dir] [measure|smoke|both] [gpu-lock-dir|-]
import { Tab } from './cdp';

const [cdp = '9710', port = '5710', shots = `${process.env.TMPDIR ?? '/tmp'}/demworker`, mode = 'both', lock = '-'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
// Hoboken, looking across the Hudson at Manhattan.
const LAT = 40.745;
const LON = -74.032;
const URL_MAP = `${BASE}/?camera=${LAT},${LON}&target=40.758,-73.985&t=2026-10-18T15:00Z`;
// Browsers without WebCodecs: Safari today. The worker must lose it too, before its modules run.
const NO_WEBCODECS = 'delete globalThis.ImageDecoder; delete globalThis.VideoFrame;';

const tab = await Tab.open(Number(cdp), BASE);
await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: NO_WEBCODECS });
// An evaluate on a worker waiting for its debugger lands in a scope its module never sees; pause at its first script instead.
tab.listeners.push((method, params, s) => {
  if (method !== 'Debugger.paused' || !s || !tab.workerSessions().some(([id]) => id === s)) return;
  void (async () => {
    if (params.reason === 'instrumentation') await tab.send('Runtime.evaluate', { expression: NO_WEBCODECS }, s);
    await tab.send('Debugger.resume', {}, s).catch(() => {});
  })();
});
tab.workerSetup.push(async (s) => {
  await tab.send('Debugger.enable', {}, s);
  await tab.send('Debugger.setInstrumentationBreakpoint', { instrumentation: 'beforeScriptExecution' }, s);
});
await tab.send('Performance.enable');
const rows: string[] = [];
let fail = false;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) fail = true;
};
const taskSeconds = async () => ((await tab.send('Performance.getMetrics')) as { metrics: { name: string; value: number }[] }).metrics.find((m) => m.name === 'TaskDuration')!.value;

function tiles(): string[] {
  const out: string[] = [];
  for (const [z, r] of [[15, 3], [14, 2], [13, 1]] as const) {
    const n = 2 ** z;
    const cx = Math.floor(((LON + 180) / 360) * n);
    const phi = (LAT * Math.PI) / 180;
    const cy = Math.floor(((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n);
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) out.push(`scape-dem://${z}/${x}/${y}`);
  }
  return out;
}

async function withLock<T>(f: () => Promise<T>): Promise<T> {
  if (lock === '-') return f();
  while ((await Bun.$`mkdir ${lock}`.nothrow().quiet()).exitCode !== 0) await Bun.sleep(30_000);
  console.error('gpu lock taken');
  try {
    return await f();
  } finally {
    await Bun.$`rmdir ${lock}`.nothrow().quiet();
  }
}

async function measure() {
  await tab.navigate(`${BASE}/robots.txt`);
  const urls = tiles();
  const src = await tab.eval<string>(`import('/src/lib/data/terrainTiles.ts').then((m) => m.TERRAIN_SOURCE_ID)`);
  check('measure: page runs without WebCodecs', src === 'aws', `terrain source ${src}`);
  const batch = `(async () => { const { demTileHandler } = await import('/src/lib/data/demProtocol.ts'); const t = performance.now(); const r = await Promise.all(${JSON.stringify(urls)}.map((url) => demTileHandler({ url }, new AbortController()).then((d) => d.data.byteLength, () => -1))); return { ms: performance.now() - t, bytes: r.reduce((a, b) => a + Math.max(b, 0), 0), failed: r.filter((b) => b < 0).length }; })()`;
  // Warm the HTTP cache and the modules so only decode and hand-off are timed.
  await tab.eval(batch, 120_000);
  const dem = tab.workerSessions().find(([, u]) => u.includes('dem.worker'))?.[0];
  const inWorker = dem ? String(((await tab.send('Runtime.evaluate', { expression: 'typeof ImageDecoder' }, dem)) as { result: { value: string } }).result.value) : 'no worker';
  check('measure: DEM worker runs without WebCodecs', inWorker === 'undefined', `ImageDecoder ${inWorker}`);
  const same = await tab.eval<{ valid: number; same: number }>(`(async () => { const T = await import('/src/lib/data/demTiles.ts'); const { demTileHandler } = await import('/src/lib/data/demProtocol.ts'); let valid = 0, same = 0;
    for (const url of ${JSON.stringify(urls)}) { const [z, x, y] = url.slice(12).split('/').map(Number); const got = await T.fetchTile({ z, x, y }); if (!got || !(await T.hasValidPost(got.data))) continue; valid++;
      const a = new Uint8Array(got.data), b = (await demTileHandler({ url }, new AbortController())).data; if (a.length === b.length && a.every((v, i) => v === b[i])) same++; }
    return { valid, same }; })()`, 120_000);
  check('measure: valid tiles pass through byte-identical', same.valid > 0 && same.same === same.valid, `${same.same} of ${same.valid} identical`);
  // One lock for the five runs: a few seconds, and they must see the same machine load.
  const runs = await withLock(async () => {
    const out: { perTileMs: number; wallMs: number; failed: number; bytes: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = await taskSeconds();
      const r = await tab.eval<{ ms: number; bytes: number; failed: number }>(batch, 120_000);
      const t1 = await taskSeconds();
      out.push({ perTileMs: ((t1 - t0) * 1000) / urls.length, wallMs: r.ms, failed: r.failed, bytes: r.bytes });
    }
    return out;
  });
  const med = runs.toSorted((a, b) => a.perTileMs - b.perTileMs)[2];
  console.error(JSON.stringify({ tiles: urls.length, runs }));
  console.log(`main-thread task time: ${med.perTileMs.toFixed(2)} ms/tile (median of 5 × ${urls.length} tiles; batch wall ${med.wallMs.toFixed(0)} ms, ${med.bytes} B, ${med.failed} failed)`);
  check('measure: every tile answered', med.failed === 0, `${med.failed} of ${urls.length} failed`);
}

async function smoke(name: string, w: number, h: number) {
  await tab.viewport(w, h, 2);
  await tab.fresh(BASE);
  await tab.navigate(URL_MAP);
  await tab.until('window.__scape && window.__scapeMap && __scapeMap.loaded()', 60_000, 250);
  // Both DEM consumers: the hillshade layer and 3D terrain, each off by default.
  await tab.eval(`__scape.settings.getState().update({ terrain: true, showHillshade: true, terrain3d: true })`);
  await Bun.sleep(500);
  const ok = await tab.until('__scapeMap.loaded() && __scapeMap.areTilesLoaded()', 60_000, 250);
  await Bun.sleep(1500);
  for (const id of ['terrain-dem-hillshade', 'terrain-dem']) await demTiles(name, id, !!ok);
  await tab.shot(`${shots}/${name}.png`);
  const worker = tab.workerSessions().some(([, u]) => u.includes('dem.worker'));
  check(`${name}: tiles come through the DEM worker`, worker, worker ? 'dem.worker attached' : 'no dem.worker');
  await tab.eval(`__scape.settings.getState().update({ showHillshade: false, terrain3d: false })`);
  // Idle: nothing may run once the map has settled.
  await Bun.sleep(2000);
  const t0 = await taskSeconds();
  await Bun.sleep(10_000);
  const busy = ((await taskSeconds()) - t0) / 10;
  check(`${name}: idle main thread`, busy < 0.02, `${(busy * 100).toFixed(2)} % busy over 10 s`);
}

async function demTiles(name: string, id: string, ok: boolean) {
  const st = await tab.eval<{ type: string; loaded: number; errored: number; dem: boolean }>(`(() => {
    const m = __scapeMap, id = '${id}', src = m.getSource(id);
    const tm = m.style.tileManagers?.[id] ?? m.style.sourceCaches?.[id];
    const all = tm ? tm.getIds().map((t) => tm.getTileByID(t)) : [];
    return { type: src?.type ?? 'none', loaded: all.filter((t) => t.state === 'loaded').length, errored: all.filter((t) => t.state === 'errored').length, dem: all.some((t) => !!t.dem) };
  })()`);
  check(`${name}: ${id} tiles render`, ok && st.type === 'raster-dem' && st.loaded > 0 && st.dem && st.errored === 0, `source ${st.type}, ${st.loaded} loaded, ${st.errored} errored, DEM ${st.dem}`);
}

await Bun.$`mkdir -p ${shots}`;
if (mode !== 'smoke') await measure();
if (mode !== 'measure') {
  await smoke('desktop', 1440, 900);
  await smoke('phone', 390, 844);
}
await tab.send('Emulation.clearDeviceMetricsOverride');
tab.close();
console.log('| check | result | detail |');
console.log('|---|---|---|');
for (const r of rows) console.log(r);
process.exit(fail ? 1 : 0);
