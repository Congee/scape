// Frame pacing of the Map tab under a trackpad pinch: ctrl-wheel events at trackpad rate, zooming in, out and back.
/* oxlint-disable no-await-in-loop -- input steps are paced one event at a time */
// Usage: bun scripts/smoke/map-zoom.ts <cdp> <dev-port> <scene> <layers> [--runs n] [--viewport WxH] [--profile <out.json>] [--shot <out.png>]
// Prints one JSON line per run.
import { Tab } from './cdp';

const args = process.argv.slice(2);
const [cdp = '9426', port = '5426', sceneName = 'rotterdam', layersName = 'default'] = args;
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const runs = Number(opt('--runs', '2'));
const [vw, vh] = opt('--viewport', '1400x900').split('x').map(Number);
const profileOut = args.includes('--profile') ? opt('--profile', '') : null;
const shot = args.includes('--shot') ? opt('--shot', '') : null;

const DAY = '2026-06-21T13:00Z';
const Scenes: Record<string, { at: string; z: number }> = {
  rotterdam: { at: '51.9091,4.4868', z: 15.5 },
  manhattan: { at: '40.7549,-73.9840', z: 15.5 },
  zermatt: { at: '45.9900,7.7200', z: 12.5 },
  plain: { at: '38.5000,-98.5000', z: 12 }
};
// Settings patches over the defaults (buildings, sun shadows, event and live lines on; hillshade and 3D terrain off).
const Layers: Record<string, Record<string, boolean>> = {
  default: {},
  bare: { showBuildings: false, showSunShadows: false, showEventLines: false, showLiveLines: false },
  nobuildings: { showBuildings: false },
  noshadow: { showSunShadows: false },
  nolines: { showEventLines: false, showLiveLines: false },
  hillshade: { showHillshade: true },
  terrain3d: { terrain3d: true },
  models: {}
};
const DEFAULTS = { terrain: true, showBuildings: true, showSunShadows: true, showEventLines: true, showLiveLines: true, showHillshade: false, terrain3d: false };

const scene = Scenes[sceneName];
const layers = Layers[layersName];
if (!scene || !layers) throw new Error(`unknown scene ${sceneName} or layers ${layersName}`);

const tab = await Tab.open(Number(cdp), `http://localhost:${port}`);
await tab.viewport(vw, vh);
await tab.navigate(`http://localhost:${port}/?camera=${scene.at}&t=${DAY}&z=${scene.z}`);
await tab.until('window.__scapeMap && window.__scapeMap.isStyleLoaded()', 60_000);

const IDLE = `(async () => {
  const m = window.__scapeMap;
  const once = () => new Promise((r) => { const t = setTimeout(() => r(false), 30000); m.once('idle', () => { clearTimeout(t); r(true); }); m.triggerRepaint(); });
  await once();
  for (let i = 0; i < 60 && window.__scape.buildings.getState().busy; i++) await new Promise((r) => setTimeout(r, 250));
  await new Promise((r) => setTimeout(r, 400));
  return await once();
})()`;

await tab.eval(`(() => { window.__scape.settings.getState().update(${JSON.stringify({ ...DEFAULTS, ...layers })}); return 1; })()`);
if (layersName === 'models') {
  // Ten Drawn boxes around the camera, as geojson extrusions on the map.
  await tab.eval(`(async () => {
    const imp = (p) => import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === p) ?? p);
    const seed = await imp('/src/lib/core/model/seed.ts');
    const b = await imp('/src/lib/state/buildings.ts');
    const ms = window.__scape.models ?? (await imp('/src/lib/state/models.ts')).modelsStore;
    const [lat, lng] = ${JSON.stringify(scene.at)}.split(',').map(Number);
    for (let i = 0; i < 10; i++) {
      const rows = await b.buildingRowsAt({ lat: lat + (i % 5) * 0.0008, lng: lng + Math.floor(i / 5) * 0.0012 });
      const m = rows && seed.seedModel(rows, 'Smoke ' + i);
      if (m) await ms.getState().save(m);
    }
    return ms.getState().models.length;
  })()`, 120_000);
}
const idle = await tab.eval<boolean>(IDLE, 90_000);

// Frame intervals from our own rAF loop, long tasks, long animation frames with their scripts, and MapLibre's own render time.
const START = `(() => {
  const m = window.__scapeMap;
  const r = window.__mz = { t: [], long: [], loaf: [], render: [], stop: false, z0: m.getZoom(), zs: [] };
  const tick = (t) => { r.t.push(t); r.zs.push(m.getZoom()); if (!r.stop) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  if (!m.__mzWrapped) {
    const orig = m._render;
    m._render = function (...a) { const s = performance.now(); const out = orig.apply(this, a); window.__mz?.render.push(performance.now() - s); return out; };
    m.__mzWrapped = true;
  }
  r.obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) r.long.push(Math.round(e.duration)); });
  r.obs.observe({ type: 'longtask' });
  r.lobs = new PerformanceObserver((l) => {
    for (const e of l.getEntries()) r.loaf.push({ d: Math.round(e.duration), block: Math.round(e.blockingDuration), scripts: e.scripts.map((s) => ({ d: Math.round(s.duration), inv: s.invoker, src: (s.sourceURL || '').replace(/^.*\\/(src|node_modules)\\//, '$1/').replace(/\\?.*$/, '') + ':' + (s.sourceFunctionName || '') })) });
  });
  r.lobs.observe({ type: 'long-animation-frame' });
  return document.visibilityState;
})()`;
const STOP = `(() => {
  const r = window.__mz; r.stop = true; r.obs.disconnect(); r.lobs.disconnect();
  const q = (xs, p) => { const d = xs.slice().sort((a, b) => a - b); return d.length ? +d[Math.min(d.length - 1, Math.floor(p * d.length))].toFixed(1) : -1; };
  const d = r.t.slice(1).map((t, i) => t - r.t[i]);
  const scripts = {};
  for (const f of r.loaf) for (const s of f.scripts) scripts[s.inv + ' ' + s.src] = (scripts[s.inv + ' ' + s.src] ?? 0) + s.d;
  const top = Object.entries(scripts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => v + 'ms ' + k);
  const zs = r.zs;
  // Per-frame zoom steps while moving; their spread is visible judder even at full frame rate.
  const steps = zs.slice(1).map((z, i) => Math.abs(z - zs[i])).filter((x) => x > 1e-4);
  const mean = steps.reduce((a, b) => a + b, 0) / (steps.length || 1);
  const stepCv = +(Math.sqrt(steps.reduce((a, b) => a + (b - mean) ** 2, 0) / (steps.length || 1)) / (mean || 1)).toFixed(2);
  return { frames: d.length, p50: q(d, 0.5), p95: q(d, 0.95), max: q(d, 1), over17: d.filter((x) => x > 17.5).length, dropped: d.filter((x) => x > 1.5 * q(d, 0.5)).length, long: r.long, loaf: r.loaf.length, loafMax: r.loaf.reduce((a, f) => Math.max(a, f.d), 0), loafScripts: top, renderP50: q(r.render, 0.5), renderP95: q(r.render, 0.95), renders: r.render.length, stepCv, overflow: document.documentElement.scrollWidth > innerWidth, zoom: [+r.z0.toFixed(2), +Math.max(...zs).toFixed(2), +Math.min(...zs).toFixed(2), +zs[zs.length - 1].toFixed(2)] };
})()`;

const box = await tab.eval<{ x: number; y: number }>('(() => { const r = document.querySelector(".map canvas").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()');
const CTRL = 2;
// A Mac trackpad pinch reaches the page as ctrl-wheel events, deltaY = -100 ln(scale), at the trackpad's 120 Hz.
const EVENT_MS = Number(opt('--event-ms', '8'));
const PHASE_MS = Number(opt('--phase', '1000'));
// A pause past MapLibre's 200 ms wheel timeout ends the gesture, so moveend work lands mid-pinch.
const PAUSE_MS = Number(opt('--pause', '0'));
async function wheelPinch(scale: number) {
  const n = Math.round((PAUSE_MS ? PHASE_MS / 4 : PHASE_MS) / EVENT_MS);
  const dy = (-100 * Math.log(scale)) / n;
  const t0 = performance.now();
  // Not awaited one by one: each ack waits for a frame, which would halve the event rate.
  const sent: Promise<unknown>[] = [];
  for (let i = 0; i < n; i++) {
    sent.push(tab.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: dy, modifiers: CTRL }));
    const wait = t0 + (i + 1) * EVENT_MS - performance.now();
    if (wait > 0) await Bun.sleep(wait);
  }
  await Promise.all(sent);
}
async function pausedPinch(scale: number) {
  for (let i = 0; i < 4; i++) {
    await wheelPinch(scale ** 0.25);
    await Bun.sleep(PAUSE_MS);
  }
}
const pinch = PAUSE_MS ? pausedPinch : wheelPinch;

type Node = { id: number; callFrame: { functionName: string; url: string; lineNumber: number } };
function hotspots(profile: { nodes: Node[]; samples: number[]; timeDeltas: number[] }): string[] {
  const self = new Map<string, number>();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  for (const [i, id] of profile.samples.entries()) {
    const f = byId.get(id)!.callFrame;
    const k = `${f.functionName || '(anon)'} ${f.url.replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`;
    self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  }
  return [...self].toSorted((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${v.toFixed(0)}ms ${k}`);
}

for (let run = 1; run <= runs; run++) {
  if (profileOut) {
    await tab.send('Profiler.enable');
    await tab.send('Profiler.setSamplingInterval', { interval: 200 });
    await tab.send('Profiler.start');
  }
  const vis = await tab.eval<string>(START);
  // 16x in, 256x out, 16x in: about two zooms in, four out, two in, back where it started.
  await pinch(16);
  await pinch(1 / 256);
  await pinch(16);
  await Bun.sleep(300);
  const r = await tab.eval<Record<string, unknown>>(STOP);
  let hot: string[] | undefined;
  if (profileOut) {
    const { profile } = (await tab.send('Profiler.stop')) as { profile: Parameters<typeof hotspots>[0] };
    await Bun.write(profileOut.replace(/\.json$/, `-${sceneName}-${layersName}-${run}.cpuprofile`), JSON.stringify(profile));
    hot = hotspots(profile);
  }
  console.log(JSON.stringify({ scene: sceneName, layers: layersName, viewport: `${vw}x${vh}`, run, idle, vis, ...r, ...(hot && { hot }) }));
  await tab.eval(IDLE, 90_000);
}
if (shot) {
  const { data } = (await tab.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
  await Bun.write(shot, Buffer.from(data, 'base64'));
}
tab.close();
