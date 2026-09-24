// Quiet budget: an idle app draws no frames and burns ~0 % CPU, per tab and scene, and again after input stops.
/* oxlint-disable no-await-in-loop -- measurements are sequential */
// Usage: bun scripts/smoke/idle.ts <cdp> <dev-port> <brave-profile> [idle-seconds] [only-case-substring]
// Prints a markdown table; exits non-zero on any budget breach.
import { Tab } from './cdp';

const [cdp = '9427', port = '5427', profile = '', secsArg = '30', only = ''] = process.argv.slice(2);
const SECS = Number(secsArg);
const BASE = `http://localhost:${port}`;
const SETTLE_MS = 20_000;
// Budget: renderer and GPU process each ≤ 2 % of a core, no GL-drawing rAF callbacks.
const CPU_MAX = 2;
// The live clock may redraw when the sky has visibly drifted: ≥ 0.5 px, about every 3.7 s at 35 mm.
const LIVE_FRAMES_MAX = Math.ceil(SECS / 3);

const Scene = {
  Rotterdam: { name: 'Rotterdam 3DBAG', camera: '51.9091,4.4868', target: '51.90664,4.48805', z: 16.5, t: '' },
  RotterdamDay: { name: 'Rotterdam day', camera: '51.9091,4.4868', target: '51.90664,4.48805', z: 16.5, t: '2026-06-21T13:00Z' },
  Manhattan: { name: 'Manhattan Overture', camera: '40.7003,-73.9967', target: '40.7484,-73.9857', z: 15, t: '' },
  Zermatt: { name: 'Zermatt terrain', camera: '46.0207,7.7491', target: '45.9766,7.6586', z: 12, t: '' },
  Night: { name: 'Night sky', camera: '46.0207,7.7491', target: '45.9766,7.6586', z: 12, t: '2026-01-15T22:00Z' }
} as const;
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
}

const cases: Case[] = [
  ...Tabs.flatMap((tab) => [Route.Map, Route.Viewfinder].map((route) => ({ scene: Scene.Rotterdam, route, tab }))),
  ...[Scene.RotterdamDay, Scene.Manhattan, Scene.Zermatt, Scene.Night].flatMap((scene) => [Route.Map, Route.Viewfinder].map((route) => ({ scene, route, tab: 'Timeline' as TabName }))),
  { scene: Scene.Rotterdam, route: Route.Map, tab: 'Timeline', phone: true },
  { scene: Scene.Rotterdam, route: Route.Viewfinder, tab: 'Frame', phone: true },
  { scene: Scene.Rotterdam, route: Route.Map, tab: 'Timeline', input: Input.Drag },
  { scene: Scene.Rotterdam, route: Route.Map, tab: 'Timeline', input: Input.Zoom },
  { scene: Scene.Rotterdam, route: Route.Map, tab: 'Timeline', input: Input.Scrub },
  { scene: Scene.Rotterdam, route: Route.Viewfinder, tab: 'Frame', input: Input.Drag },
  { scene: Scene.Rotterdam, route: Route.Viewfinder, tab: 'Frame', input: Input.Zoom },
  { scene: Scene.Rotterdam, route: Route.Viewfinder, tab: 'Frame', input: Input.Scrub }
];

const label = (c: Case) => `${c.scene.name} · ${c.route || 'map'} · ${c.tab}${c.phone ? ' · phone' : ''}${c.input ? ` · after ${c.input}` : ''}`;

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
  pass: boolean;
}

async function measure(c: Case): Promise<Row> {
  const q = [`camera=${c.scene.camera}`, `target=${c.scene.target}`, `z=${c.scene.z}`, ...(c.scene.t ? [`t=${c.scene.t}`] : [])].join('&');
  await tab.send('Emulation.setDeviceMetricsOverride', c.phone ? { width: 390, height: 844, deviceScaleFactor: 3, mobile: true } : { width: 1400, height: 900, deviceScaleFactor: 2, mobile: false });
  await tab.eval(`localStorage.setItem('scape.ui', JSON.stringify({ state: { panelTab: ${JSON.stringify(c.tab === 'Models' ? 'Markers' : c.tab)}, panelCollapsed: false, markersView: ${JSON.stringify(c.tab === 'Models' ? 'Models' : 'Markers')} }, version: 0 }))`).catch(() => {});
  await tab.navigate(`${BASE}/${c.route}?${q}`);
  await tab.until('window.__scape?.idle', 30_000);
  // A pinned instant persists live=false; a scene without one is the live clock.
  if (!c.scene.t) await tab.eval('window.__scape.world.getState().setNow()');
  await Bun.sleep(SETTLE_MS);
  if (c.input) {
    await drive(c);
    await Bun.sleep(1000);
  }
  await tab.eval('window.__scape.idle.reset()');
  const cpu0 = await cpuTimes();
  const task0 = await taskSecs();
  const t0 = performance.now();
  await Bun.sleep(SECS * 1000);
  const dt = (performance.now() - t0) / 1000;
  const cpu1 = await cpuTimes();
  const task1 = await taskSecs();
  const p = await tab.eval<{ raf: number; glFrames: number; timers: number }>('(() => { const p = window.__scape.idle; return { raf: p.raf, glFrames: p.glFrames, timers: p.timers }; })()');
  const pct = (a: number, b: number) => +((100 * (b - a)) / dt).toFixed(1);
  const r: Row = { label: label(c), renderer: pct(0, rendererDelta(cpu0.renderer, cpu1.renderer)), gpu: pct(cpu0.gpu, cpu1.gpu), task: pct(task0, task1), ...p, pass: false };
  const live = !c.scene.t && c.input !== Input.Scrub;
  r.pass = r.renderer <= CPU_MAX && r.gpu <= CPU_MAX && r.glFrames <= (live ? LIVE_FRAMES_MAX : 0);
  return r;
}

const rows: Row[] = [];
for (const c of cases.filter((k) => label(k).includes(only))) {
  const r = await measure(c);
  rows.push(r);
  console.error(JSON.stringify(r));
}
await tab.send('Emulation.clearDeviceMetricsOverride');
tab.close();

console.log(`| case (${SECS} s idle) | renderer % | GPU % | TaskDuration % | rAF | GL frames | timers | result |`);
console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.label} | ${r.renderer} | ${r.gpu} | ${r.task} | ${r.raf} | ${r.glFrames} | ${r.timers} | ${r.pass ? 'PASS' : 'FAIL'} |`);
process.exit(rows.every((r) => r.pass) ? 0 : 1);
