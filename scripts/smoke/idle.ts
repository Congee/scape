// Quiet budget: an idle app draws no frames, commits nothing, leaves the DOM alone, fetches nothing and burns ~0 % CPU, per tab and scene, and again after input stops.
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
// The live-tick case may land one map shadow-mask re-stamp on top of the 2 % (after dirty-rect re-stamps: 1.7–2.1 s CPU, 40 fetches).
const RESTAMP_MAX = 1;
const RESTAMP_CPU_S = 2.5;
const RESTAMP_FETCH_MAX = 50;
// DOM the minute tick itself may change: the Timeline's now line and the sun and moon readouts.
const TICK_DOM = /^(span < li\.now-line|span\.(val|extra) < div\.readout-row\S*) /;

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
// Counts DOM mutations by target, e.g. `div.time-label attr:style` or `span text`.
const MUTATION_HOOK = `(() => {
  const m = { count: 0, targets: {}, reset() { m.count = 0; m.targets = {}; } };
  window.__mutations = m;
  const one = (e) => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
  // The element, and its nearest ancestor with a class, e.g. span.val < div.readout-row.
  const name = (n) => {
    const e = n.nodeType === 1 ? n : n.parentElement;
    if (!e) return '#' + n.nodeName;
    let p = e.parentElement;
    while (p && !(typeof p.className === 'string' && p.className)) p = p.parentElement;
    return one(e) + (p ? ' < ' + one(p) : '');
  };
  new MutationObserver((rs) => {
    for (const r of rs) {
      m.count++;
      const k = name(r.target) + ' ' + (r.type === 'attributes' ? 'attr:' + r.attributeName : r.type === 'characterData' ? 'text' : 'children');
      m.targets[k] = (m.targets[k] ?? 0) + 1;
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
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

const Tabs = ['Now', 'Shot', 'Sky', 'Find', 'Weather', 'Map', 'View', 'Markers', 'Models'] as const;
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
  // Map is the map page's tab, View the viewfinder's.
  ...Tabs.flatMap((tab) => [Route.Map, Route.Viewfinder].filter((route) => tab !== (route === Route.Map ? 'View' : 'Map')).map((route) => ({ scene: Scene.Rotterdam, route, tab }))),
  ...[Scene.RotterdamDay, Scene.Manhattan, Scene.Zermatt, Scene.Night].flatMap((scene) => [Route.Map, Route.Viewfinder].map((route) => ({ scene, route, tab: 'Now' as TabName }))),
  { scene: Scene.Rotterdam, route: Route.Map, tab: 'Now', phone: true },
  { scene: Scene.Rotterdam, route: Route.Viewfinder, tab: 'Shot', phone: true },
  { scene: Scene.Rotterdam, route: Route.Map, tab: 'Now', input: Input.Drag },
  { scene: Scene.Rotterdam, route: Route.Map, tab: 'Now', input: Input.Zoom },
  // Scrubs start from a pinned instant, so every run sweeps the same sky.
  { scene: Scene.RotterdamDay, route: Route.Map, tab: 'Now', input: Input.Scrub },
  { scene: Scene.Rotterdam, route: Route.Viewfinder, tab: 'Shot', input: Input.Drag },
  { scene: Scene.Rotterdam, route: Route.Viewfinder, tab: 'Shot', input: Input.Zoom },
  { scene: Scene.RotterdamDay, route: Route.Viewfinder, tab: 'Shot', input: Input.Scrub },
  ...[Scene.Rotterdam, Scene.Zermatt, Scene.Night].flatMap((scene) => [Route.Map, Route.Viewfinder].map((route) => ({ scene, route, tab: (route === Route.Map ? 'Now' : 'Shot') as TabName, hidden: true }))),
  { scene: Scene.Rotterdam, route: Route.Map, tab: 'Sky', hidden: true },
  { scene: Scene.Rotterdam, route: Route.Map, tab: 'Weather', hidden: true },
  // The one real minute tick, under a low sun: its budget allows a mask re-stamp.
  { scene: Scene.Rotterdam, route: Route.Map, tab: 'Now', clock: '2026-06-21T19:00Z' }
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

/** Requests of this origin's service workers, which the page's own sessions never see. */
async function serviceWorkerLog(cdpPort: number) {
  const { webSocketDebuggerUrl } = (await (await fetch(`http://localhost:${cdpPort}/json/version`)).json()) as { webSocketDebuggerUrl: string };
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((ok, fail) => (ws.addEventListener('open', ok), ws.addEventListener('error', fail)));
  let seq = 0;
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) => ws.send(JSON.stringify({ id: ++seq, method, params, ...(sessionId && { sessionId }) }));
  const log = { on: false, requests: [] as string[], close: () => ws.close() };
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data)) as { method?: string; params?: Record<string, unknown>; sessionId?: string };
    if (m.method === 'Target.attachedToTarget') {
      const p = m.params as { sessionId: string; targetInfo: { url: string } };
      if (!p.targetInfo.url.startsWith(BASE)) return;
      send('Network.enable', {}, p.sessionId);
      send('Runtime.runIfWaitingForDebugger', {}, p.sessionId);
    } else if (m.method === 'Network.requestWillBeSent' && log.on) log.requests.push(String((m.params as { request: { url: string } }).request.url));
  });
  send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: 'service_worker' }, { exclude: true }] });
  return log;
}

const tab = await Tab.open(Number(cdp), BASE);
const sw = await serviceWorkerLog(Number(cdp));
// The last run's service worker would serve its build to the first case.
await tab.send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'service_workers' });
await tab.send('Performance.enable');
await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: COMMIT_HOOK });
await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK_HOOK });
await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: MUTATION_HOOK });
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
  mutations: number;
  fetches: number;
  swFetches: number;
  urls: string[];
  /** What changed besides the minute tick's own updates, or anything at all where time is pinned. */
  offenders: string[];
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
  const panelPage = c.route === Route.Map ? 'map' : 'viewfinder';
  const panelTabs = { map: 'Now', viewfinder: 'View', [panelPage]: c.tab === 'Models' ? 'Markers' : c.tab };
  await tab.eval(`localStorage.setItem('scape.ui', JSON.stringify({ state: { panelTabs: ${JSON.stringify(panelTabs)}, panelCollapsed: false, markersView: ${JSON.stringify(c.tab === 'Models' ? 'Models' : 'Markers')} }, version: 2 }))`).catch(() => {});
  await tab.navigate(`${BASE}/${c.route}?${q}`);
  await tab.until('window.__scape?.idle', 30_000);
  // A pinned instant persists live=false; a scene without one is the live clock.
  if (!t) await tab.eval('window.__scape.world.getState().setNow()');
  // A first visit under load can still be sweeping terrain at the settle mark; the budget starts once it is in.
  await tab.until('!Object.values(window.__scape.terrain.getState().busy).some(Boolean)', 120_000);
  await Bun.sleep(SETTLE_MS);
  if (c.input) {
    await drive(c);
    await Bun.sleep(1000);
    // The mask worker may still be fetching tiles the new sun or view reaches; its answer paints once more.
    if (await tab.eval<boolean>('!!window.__scape.shadowPending?.()')) {
      await tab.until('!window.__scape.shadowPending()', 60_000, 100);
      await Bun.sleep(1000);
    }
  }
  if (c.hidden) {
    await tab.eval(HIDE(true));
    await Bun.sleep(1000);
  }
  // Land the tick a quarter into the window, so its work finishes inside it.
  if (c.clock) await Bun.sleep(await tab.eval<number>(`(60000 - Date.now() % 60000 + 60000 - ${(SECS * 250) | 0}) % 60000`));
  await tab.logRequests();
  sw.requests.length = 0;
  sw.on = true;
  const grids0 = await tab.eval<number>('window.__masks.grids.length');
  await tab.eval('window.__scape.idle.reset(); window.__commits?.reset(); window.__mutations?.reset()');
  const cpu0 = await cpuTimes();
  const task0 = await taskSecs();
  const t0 = performance.now();
  await Bun.sleep(SECS * 1000);
  const dt = (performance.now() - t0) / 1000;
  const cpu1 = await cpuTimes();
  const task1 = await taskSecs();
  tab.stopRequests();
  sw.on = false;
  // A request the page made that the worker passed on is one fetch, not two.
  const page = new Set(tab.requests);
  const swOnly = sw.requests.filter((u) => !page.has(u));
  const fetches = tab.requests.length + swOnly.length;
  const urls = [...tab.requests, ...swOnly.map((u) => `sw ${u}`)].slice(0, 10);
  const grids = await tab.eval<string[]>('window.__masks.grids');
  const restamps = grids.slice(grids0).filter((g, i) => g !== grids[grids0 + i - 1]).length;
  const p = await tab.eval<{ raf: number; glFrames: number; timers: number; commits: number; renders: number; mutations: number }>('(() => { const p = window.__scape.idle, c = window.__commits ?? {}; return { raf: p.raf, glFrames: p.glFrames, timers: p.timers, commits: c.commits ?? -1, renders: c.renders ?? -1, mutations: window.__mutations?.count ?? -1 }; })()');
  const mutated = await tab.eval<[string, number][]>('Object.entries(window.__mutations?.targets ?? {}).sort((a, b) => b[1] - a[1])');
  const pct = (a: number, b: number) => +((100 * (b - a)) / dt).toFixed(1);
  const r: Row = { label: label(c), renderer: pct(0, rendererDelta(cpu0.renderer, cpu1.renderer)), gpu: pct(cpu0.gpu, cpu1.gpu), task: pct(task0, task1), ...p, fetches, swFetches: sw.requests.length, urls, offenders: [], restamps, cpuS: +(rendererDelta(cpu0.renderer, cpu1.renderer) + cpu1.gpu - cpu0.gpu).toFixed(2), top: await tab.eval('Object.entries(window.__commits?.names ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 8)'), pass: false };
  if (c.hidden) await tab.eval(HIDE(false));
  const live = !t && !c.hidden;
  // Hidden, nothing may run at all: no frames, timers or fetches.
  const quiet = !c.hidden || (r.raf === 0 && r.timers === 0 && r.fetches === 0);
  // Visible with time pinned, the screen and the network stay still: no frame, commit, DOM change or fetch.
  if (!c.hidden && !live) {
    for (const [k, n] of [['rAF', r.raf], ['GL frames', r.glFrames], ['React commits', r.commits], ['DOM mutations', r.mutations], ['fetches', r.fetches]] as const) if (n !== 0) r.offenders.push(`${k} ${n}`);
    r.offenders.push(...mutated.map(([k, n]) => `dom ${k} ×${n}`), ...r.top.map(([k, n]) => `render ${k} ×${n}`), ...urls.map((u) => `fetch ${u}`));
  }
  // The live tick may change only its own readouts; anything else is listed.
  if (c.clock) r.offenders.push(...mutated.filter(([k]) => !TICK_DOM.test(k)).map(([k, n]) => `dom ${k} ×${n}`));
  // A re-stamp may spend RESTAMP_CPU_S over the window's 2 % in the renderer; the GPU keeps its 2 %.
  const restampOk = c.clock ? r.restamps <= RESTAMP_MAX && r.fetches <= RESTAMP_FETCH_MAX : true;
  const rendererMax = c.clock && r.restamps > 0 ? CPU_MAX + (100 * RESTAMP_CPU_S) / dt : CPU_MAX;
  r.pass = r.renderer <= rendererMax && r.gpu <= CPU_MAX && r.glFrames <= (live ? LIVE_FRAMES_MAX : 0) && quiet && restampOk && r.offenders.length === 0;
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
sw.close();

console.log(`| case (${SECS} s idle) | renderer % | GPU % | TaskDuration % | rAF | GL frames | timers | React commits | renders | DOM mutations | fetches (SW) | mask re-stamps | CPU s | result |`);
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.label} | ${r.renderer} | ${r.gpu} | ${r.task} | ${r.raf} | ${r.glFrames} | ${r.timers} | ${r.commits} | ${r.renders} | ${r.mutations} | ${r.fetches} (${r.swFetches}) | ${r.restamps} | ${r.cpuS} | ${r.pass ? 'PASS' : `FAIL${r.offenders.length ? `: ${r.offenders.slice(0, 6).join('; ')}` : ''}`} |`);
process.exit(rows.every((r) => r.pass) ? 0 : 1);
