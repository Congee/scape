// Quiet budget: an idle app draws no frames and burns ~0 % CPU, per tab and scene, and again after input stops.
/* oxlint-disable no-await-in-loop -- measurements are sequential */
// Usage: bun scripts/smoke/idle.ts <cdp> <port> <brave-profile> [idle-seconds] [only-case-substring, or =exact-label]
// Prints a markdown table; exits non-zero on any budget breach.
import { Tab } from './cdp';

const [cdp = '9427', port = '5427', profile = '', secsArg = '30', only = ''] = process.argv.slice(2);
const SECS = Number(secsArg);
const BASE = `http://localhost:${port}`;
// V8's post-load memory reducer runs GCs for ~45 s; the budget is for the steady state after it.
const SETTLE_MS = 45_000;
// Budget: renderer and GPU process each ≤ 2 % of a core, no GL-drawing rAF callbacks.
const CPU_MAX = 2;
// The live clock may redraw when the sky has visibly drifted: ≥ 0.5 px, about every 3.7 s at 35 mm.
const LIVE_FRAMES_MAX = Math.ceil(SECS / 3);
// The live-tick case may land one map shadow-mask re-stamp on top of the 2 % (after strip re-stamps: 4.6–6.2 s CPU, 53–65 fetches).
const RESTAMP_MAX = 1;
const RESTAMP_CPU_S = 8;
const RESTAMP_FETCH_MAX = 80;

const Scene = {
  // `noon`: a visible live scene is pinned here, with the sun high, so no minute tick can land a mask re-stamp in the window.
  Rotterdam: { name: 'Rotterdam 3DBAG', camera: '51.9091,4.4868', target: '51.90664,4.48805', z: 16.5, t: '', noon: '2026-06-21T11:40Z' },
  RotterdamDay: { name: 'Rotterdam day', camera: '51.9091,4.4868', target: '51.90664,4.48805', z: 16.5, t: '2026-06-21T13:00Z' },
  Manhattan: { name: 'Manhattan Overture', camera: '40.7003,-73.9967', target: '40.7484,-73.9857', z: 15, t: '', noon: '2026-06-21T16:55Z' },
  Zermatt: { name: 'Zermatt terrain', camera: '46.0207,7.7491', target: '45.9766,7.6586', z: 12, t: '', noon: '2026-06-21T11:30Z' },
  Night: { name: 'Night sky', camera: '46.0207,7.7491', target: '45.9766,7.6586', z: 12, t: '2026-01-15T22:00Z' }
} as const;
// A stand-in DevTools hook: counts React commits and the components each re-ran (a bailed-out subtree keeps its old child).
const COMMIT_HOOK = `(() => {
  const c = { commits: 0, renders: 0, names: {}, reset() { c.commits = c.renders = 0; c.names = {}; } };
  window.__commits = c;
  const kinds = new Set([0, 1, 11, 14, 15]);
  const walk = (f) => {
    for (; f; f = f.sibling) {
      if (kinds.has(f.tag) && f.flags & 1) {
        c.renders++;
        const t = f.type?.type ?? f.type?.render ?? f.type;
        const n = t?.displayName || t?.name || '?';
        c.names[n] = (c.names[n] ?? 0) + 1;
      }
      if (!f.alternate || f.child !== f.alternate.child) walk(f.child);
    }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, isDisabled: false, renderers: new Map(), inject: (r) => 1, checkDCE() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onCommitFiberRoot(_id, root) { c.commits++; walk(root.current.child); } };
})();`;
// For the live-tick case: shifts the page clock to a stored instant, so the real minute tick runs under a low sun; records each shadow-mask grid posted to a worker.
const CLOCK_HOOK = `(() => {
  const m = { grids: [] };
  window.__masks = m;
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (d, ...rest) {
    if (d && d.kind === 'Mask') m.grids.push([d.centre.lat, d.centre.lng, d.originE, d.originN, d.nx, d.ny, d.cellM, d.softM, d.buildings].join('|'));
    return post.call(this, d, ...rest);
  };
  let at = 0;
  try { at = Number(localStorage.getItem('scape.idle.clockAt')); } catch {}
  if (!at) return;
  const RealDate = Date, realNow = RealDate.now, off = at - realNow();
  class ShiftedDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(realNow() + off); }
    static now() { return realNow() + off; }
  }
  window.Date = ShiftedDate;
})();`;

// A covered window or a background tab: the app sees what the browser would tell it, while rAF stays alive to catch any loop.
const HIDE = (hidden: boolean) =>
  `(() => { for (const [k, v] of [['hidden', ${hidden}], ['visibilityState', '${hidden ? 'hidden' : 'visible'}']]) Object.defineProperty(document, k, { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); })()`;

type Scene = (typeof Scene)[keyof typeof Scene];

const Tabs = ['Timeline', 'Geodetics', 'Frame', 'Night', 'Tools', 'Find', 'Markers', 'Models', 'Layers', 'Offline'] as const;
type TabName = (typeof Tabs)[number];

const Route = { Map: '', Viewfinder: 'viewfinder' } as const;
type Route = (typeof Route)[keyof typeof Route];

const Input = { None: 'none', Drag: 'drag', Zoom: 'zoom', Scrub: 'scrub' } as const;
type Input = (typeof Input)[keyof typeof Input];

interface Case {
  scene: Scene;
  route: Route;
  tab: TabName;
  phone?: boolean;
  input?: Input;
  hidden?: boolean;
  /** Runs the live clock from this instant (a shifted real clock), with a minute tick landing inside the window. */
  clock?: string;
}

const cases: Case[] = [
  ...Tabs.flatMap((tab) => [Route.Map, Route.Viewfinder].map((route) => ({ scene: Scene.Rotterdam, route, tab }))),
  ...[Scene.RotterdamDay, Scene.Manhattan, Scene.Zermatt, Scene.Night].flatMap((scene) => [Route.Map, Route.Viewfinder].map((route) => ({ scene, route, tab: 'Timeline' as TabName }))),
  { scene: Scene.Rotterdam, route: Route.Map, tab: 'Timeline', phone: true },
  { scene: Scene.Rotterdam, route: Route.Viewfinder, tab: 'Frame', phone: true },
  { scene: Scene.Rotterdam, route: Route.Map, tab: 'Timeline', input: Input.Drag },
  { scene: Scene.Rotterdam, route: Route.Map, tab: 'Timeline', input: Input.Zoom },
  // Scrubs start from a pinned instant, so every run sweeps the same sky.
  { scene: Scene.RotterdamDay, route: Route.Map, tab: 'Timeline', input: Input.Scrub },
  { scene: Scene.Rotterdam, route: Route.Viewfinder, tab: 'Frame', input: Input.Drag },
  { scene: Scene.Rotterdam, route: Route.Viewfinder, tab: 'Frame', input: Input.Zoom },
  { scene: Scene.RotterdamDay, route: Route.Viewfinder, tab: 'Frame', input: Input.Scrub },
  ...[Scene.Rotterdam, Scene.Zermatt, Scene.Night].flatMap((scene) => [Route.Map, Route.Viewfinder].map((route) => ({ scene, route, tab: (route === Route.Map ? 'Timeline' : 'Frame') as TabName, hidden: true }))),
  { scene: Scene.Rotterdam, route: Route.Map, tab: 'Night', hidden: true },
  { scene: Scene.Rotterdam, route: Route.Map, tab: 'Tools', hidden: true },
  // The one real minute tick, under a low sun: its budget allows a mask re-stamp.
  { scene: Scene.Rotterdam, route: Route.Map, tab: 'Timeline', clock: '2026-06-21T19:00Z' }
];

const label = (c: Case) => `${c.scene.name} · ${c.route || 'map'} · ${c.tab}${c.phone ? ' · phone' : ''}${c.input ? ` · after ${c.input}` : ''}${c.hidden ? ' · hidden' : ''}${c.clock ? ` · live tick ${c.clock}` : ''}`;

/** Cumulative CPU seconds of this profile's renderer and GPU processes, by pid. */
async function cpuTimes(): Promise<{ renderer: Map<string, number>; gpu: number }> {
  const out = await new Response(Bun.spawn(['ps', '-axo', 'pid=,time=,command='], { stdout: 'pipe' }).stdout).text();
  const t = { renderer: new Map<string, number>(), gpu: 0 };
  for (const line of out.split('\n')) {
    if (!line.includes(`--user-data-dir=${profile}`)) continue;
    const m = /^\s*(\d+)\s+(\S+)\s/.exec(line);
    if (!m) continue;
    const secs = m[2].split(':').reduce((a, p) => a * 60 + Number(p), 0);
    if (line.includes('--type=renderer') && !line.includes('--extension-process')) t.renderer.set(m[1], secs);
    else if (line.includes('--type=gpu-process')) t.gpu += secs;
  }
  return t;
}

/** The busiest renderer over the window is the app tab's. */
const rendererDelta = (a: Map<string, number>, b: Map<string, number>) => Math.max(0, ...[...b].map(([pid, s]) => s - (a.get(pid) ?? s)));

const tab = await Tab.open(Number(cdp), BASE);
await tab.send('Performance.enable');
await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: COMMIT_HOOK });
await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK_HOOK });
const taskSecs = async () => ((await tab.send('Performance.getMetrics')) as { metrics: { name: string; value: number }[] }).metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0;

const mouse = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) => tab.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, ...extra });

async function drive(c: Case) {
  const sel = c.route === Route.Viewfinder ? '.vf-gl' : '.maplibregl-canvas';
  const box = await tab.eval<{ x: number; y: number }>(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (c.input === Input.Drag) {
    await mouse('mousePressed', box.x, box.y, { clickCount: 1 });
    for (let i = 0; i < 60; i++) {
      await mouse('mouseMoved', box.x + 100 * Math.sin(i / 10), box.y + 20 * Math.sin(i / 15));
      await Bun.sleep(16);
    }
    await mouse('mouseReleased', box.x, box.y, { clickCount: 1 });
  } else if (c.input === Input.Zoom) {
    for (let i = 0; i < 30; i++) {
      await tab.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: i < 15 ? -40 : 40 });
      await Bun.sleep(16);
    }
  } else if (c.input === Input.Scrub) {
    for (let i = 0; i < 60; i++) {
      await tab.eval('(() => { const w = window.__scape.world.getState(); w.setTime(w.time + 60000); })()');
      await Bun.sleep(16);
    }
  }
}

interface Row {
  label: string;
  renderer: number;
  gpu: number;
  task: number;
  raf: number;
  glFrames: number;
  timers: number;
  commits: number;
  renders: number;
  fetches: number;
  urls: string[];
  restamps: number;
  cpuS: number;
  top: [string, number][];
  pass: boolean;
}

async function measure(c: Case): Promise<Row> {
  // Hidden cases keep the live clock: a hidden page must not tick at all.
  const t = c.scene.t || (c.hidden || c.clock || !('noon' in c.scene) ? '' : c.scene.noon);
  const q = [`camera=${c.scene.camera}`, `target=${c.scene.target}`, `z=${c.scene.z}`, ...(t ? [`t=${t}`] : [])].join('&');
  await tab.send('Emulation.setDeviceMetricsOverride', c.phone ? { width: 390, height: 844, deviceScaleFactor: 3, mobile: true } : { width: 1400, height: 900, deviceScaleFactor: 2, mobile: false });
  await tab.eval(c.clock ? `localStorage.setItem('scape.idle.clockAt', '${Date.parse(c.clock)}')` : `localStorage.removeItem('scape.idle.clockAt')`).catch(() => {});
  await tab.eval(`localStorage.setItem('scape.ui', JSON.stringify({ state: { panelTab: ${JSON.stringify(c.tab === 'Models' ? 'Markers' : c.tab)}, panelCollapsed: false, markersView: ${JSON.stringify(c.tab === 'Models' ? 'Models' : 'Markers')} }, version: 0 }))`).catch(() => {});
  await tab.navigate(`${BASE}/${c.route}?${q}`);
  await tab.until('window.__scape?.idle', 30_000);
  // A pinned instant persists live=false; a scene without one is the live clock.
  if (!t) await tab.eval('window.__scape.world.getState().setNow()');
  await Bun.sleep(SETTLE_MS);
  if (c.input) {
    await drive(c);
    await Bun.sleep(1000);
  }
  if (c.hidden) {
    await tab.eval(HIDE(true));
    await Bun.sleep(1000);
  }
  // Land the tick a quarter into the window, so its work finishes inside it.
  if (c.clock) await Bun.sleep(await tab.eval<number>(`(60000 - Date.now() % 60000 + 60000 - ${(SECS * 250) | 0}) % 60000`));
  await tab.logRequests();
  const grids0 = await tab.eval<number>('window.__masks.grids.length');
  await tab.eval('window.__scape.idle.reset(); window.__commits?.reset()');
  const cpu0 = await cpuTimes();
  const task0 = await taskSecs();
  const t0 = performance.now();
  await Bun.sleep(SECS * 1000);
  const dt = (performance.now() - t0) / 1000;
  const cpu1 = await cpuTimes();
  const task1 = await taskSecs();
  const fetches = tab.requests.length;
  const urls = tab.requests.slice(0, 10);
  tab.stopRequests();
  const grids = await tab.eval<string[]>('window.__masks.grids');
  const restamps = grids.slice(grids0).filter((g, i) => g !== grids[grids0 + i - 1]).length;
  const p = await tab.eval<{ raf: number; glFrames: number; timers: number; commits: number; renders: number }>('(() => { const p = window.__scape.idle, c = window.__commits ?? {}; return { raf: p.raf, glFrames: p.glFrames, timers: p.timers, commits: c.commits ?? -1, renders: c.renders ?? -1 }; })()');
  const pct = (a: number, b: number) => +((100 * (b - a)) / dt).toFixed(1);
  const r: Row = { label: label(c), renderer: pct(0, rendererDelta(cpu0.renderer, cpu1.renderer)), gpu: pct(cpu0.gpu, cpu1.gpu), task: pct(task0, task1), ...p, fetches, urls, restamps, cpuS: +(rendererDelta(cpu0.renderer, cpu1.renderer) + cpu1.gpu - cpu0.gpu).toFixed(2), top: await tab.eval('Object.entries(window.__commits?.names ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 8)'), pass: false };
  if (c.hidden) await tab.eval(HIDE(false));
  const live = !t && !c.hidden;
  // Hidden, nothing may run at all: no frames, timers or fetches.
  const quiet = !c.hidden || (r.raf === 0 && r.timers === 0 && r.fetches === 0);
  // A re-stamp may spend RESTAMP_CPU_S over the window's 2 % in the renderer; the GPU keeps its 2 %.
  const restampOk = c.clock ? r.restamps <= RESTAMP_MAX && r.fetches <= RESTAMP_FETCH_MAX : true;
  const rendererMax = c.clock && r.restamps > 0 ? CPU_MAX + (100 * RESTAMP_CPU_S) / dt : CPU_MAX;
  r.pass = r.renderer <= rendererMax && r.gpu <= CPU_MAX && r.glFrames <= (live ? LIVE_FRAMES_MAX : 0) && quiet && restampOk;
  return r;
}

const rows: Row[] = [];
for (const c of cases.filter((k) => (only.startsWith('=') ? label(k) === only.slice(1) : label(k).includes(only)))) {
  const r = await measure(c);
  rows.push(r);
  console.error(JSON.stringify(r));
}
await tab.send('Emulation.clearDeviceMetricsOverride');
tab.close();

console.log(`| case (${SECS} s idle) | renderer % | GPU % | TaskDuration % | rAF | GL frames | timers | React commits | renders | fetches | mask re-stamps | CPU s | result |`);
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.label} | ${r.renderer} | ${r.gpu} | ${r.task} | ${r.raf} | ${r.glFrames} | ${r.timers} | ${r.commits} | ${r.renders} | ${r.fetches} | ${r.restamps} | ${r.cpuS} | ${r.pass ? 'PASS' : 'FAIL'} |`);
process.exit(rows.every((r) => r.pass) ? 0 : 1);
