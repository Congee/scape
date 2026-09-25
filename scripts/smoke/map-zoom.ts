// How a Map-tab zoom feels: replays a realistic trackpad stream (or a trace recorded with ?zoomprobe) and scores what reached the screen.
/* oxlint-disable no-await-in-loop -- input is paced one event at a time */
// Usage: bun scripts/smoke/map-zoom.ts <cdp> <port> <scene> <layers> [--stream pinch|scroll|flick] [--trace scape-zoom.json] [--inject block|ease]
//   [--seed n] [--zooms n] [--runs n] [--depth n] [--viewport WxH[@dpr]] [--profile <out.json>] [--shot <out.png>] [--save <trace.json>]
// Works on dev and preview builds alike. Prints one JSON line per run.
import { analyze, pipelineFrames, StreamKind, trackpadStream, wheelPixels, type StreamEvent, type TraceEvent, type ZoomTrace } from '../../src/lib/ui/map/zoomTrace';
import { Tab } from './cdp';
import { DEFAULTS, Injects, Layers, Scenes, sceneUrl } from './map-zoom-scenes';

const args = process.argv.slice(2);
const [cdp = '9426', port = '5426', sceneName = 'hoboken', layersName = 'default'] = args;
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const runs = Number(opt('--runs', '1'));
const [vw, vh, vdpr = 2] = opt('--viewport', '1400x900').split(/[x@]/).map(Number);
const profileOut = args.includes('--profile') ? opt('--profile', '') : null;
const shot = args.includes('--shot') ? opt('--shot', '') : null;
const saveTo = args.includes('--save') ? opt('--save', '') : null;
const traceFile = args.includes('--trace') ? opt('--trace', '') : null;
const kind = opt('--stream', StreamKind.Pinch) as StreamKind;
const injectName = opt('--inject', '');
const depth = Number(opt('--depth', '3'));

const scene = Scenes[sceneName];
const layers = Layers[layersName];
if (!scene || !layers) throw new Error(`unknown scene ${sceneName} or layers ${layersName}`);
if (injectName && !Injects[injectName]) throw new Error(`unknown inject ${injectName}`);

let stream: (StreamEvent & { shift?: boolean })[];
if (traceFile) {
  const tr = (await Bun.file(traceFile).json()) as ZoomTrace;
  const w = tr.wheel.filter((e) => e.dy);
  stream = w.map((e) => ({ dt: e.t - w[0].t, dy: wheelPixels({ ...e, shift: false }), ctrl: e.ctrl, shift: e.shift }));
} else stream = trackpadStream(kind, { seed: Number(opt('--seed', '1')), zooms: Number(opt('--zooms', '1.5')) });

const origin = `http://localhost:${port}`;
const url = sceneUrl(origin, scene);
const tab = await Tab.open(Number(cdp), origin);
await tab.viewport(vw, vh, vdpr);
await tab.navigate(url);
// Settings through storage, so a preview build (no dev hooks) takes them too.
await tab.eval(`(() => {
  const k = 'scape.settings';
  const v = JSON.parse(localStorage.getItem(k) ?? '{"state":{},"version":0}');
  Object.assign(v.state, ${JSON.stringify({ ...DEFAULTS, ...layers })});
  localStorage.setItem(k, JSON.stringify(v));
  return 1;
})()`);
await tab.navigate(url);
const MAP = 'window.__scape?.zoomProbe?.map';
await tab.until(`${MAP}?.isStyleLoaded()`, 60_000);
const build = (await tab.eval<boolean>('!!window.__scapeMap')) ? 'dev' : 'preview';
const camera = `{ zoom: ${scene.z}, center: [${scene.at.split(',').toReversed().join(',')}], pitch: ${scene.pitch ?? 0}, bearing: ${scene.bearing ?? 0} }`;
await tab.eval(`(() => { ${MAP}.jumpTo(${camera}); return 1; })()`);

const IDLE = `(async () => {
  const m = ${MAP};
  const once = () => new Promise((r) => { const t = setTimeout(() => r(false), 30000); m.once('idle', () => { clearTimeout(t); r(true); }); m.triggerRepaint(); });
  await once();
  for (let i = 0; i < 60 && window.__scape.buildings?.getState().busy; i++) await new Promise((r) => setTimeout(r, 250));
  await new Promise((r) => setTimeout(r, 400));
  return await once();
})()`;
const idle = await tab.eval<boolean>(IDLE, 90_000);

const box = await tab.eval<{ x: number; y: number }>('(() => { const r = document.querySelector(".map canvas").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()');
const CTRL = 2;
const SHIFT = 8;
const acks: number[] = [];
async function play(events: typeof stream) {
  const t0 = performance.now();
  // A few events in flight until the page acks them, the rest merged while they wait, as Chrome's own wheel queue does; CDP would queue them all.
  type Wheel = { dy: number; modifiers: number; at: number };
  let inflight = 0;
  const waiting: Wheel[] = [];
  let drained: (() => void) | null = null;
  // Stamped when generated, so time spent queued counts as latency.
  const send = (w: Wheel) => {
    const s = performance.now();
    inflight++;
    void tab.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: w.dy, modifiers: w.modifiers, timestamp: w.at / 1000 }).then(() => {
      acks.push(performance.now() - s);
      inflight--;
      const next = waiting.shift();
      if (next) send(next);
      else if (!inflight) drained?.();
    });
  };
  for (const e of events) {
    const wait = t0 + e.dt - performance.now();
    if (wait > 0) await Bun.sleep(wait);
    const w = { dy: e.dy, modifiers: (e.ctrl ? CTRL : 0) | (e.shift ? SHIFT : 0), at: performance.timeOrigin + performance.now() };
    const last = waiting.at(-1);
    if (inflight < depth) send(w);
    else if (last?.modifiers === w.modifiers) last.dy += w.dy;
    else waiting.push(w);
  }
  if (inflight) await new Promise<void>((r) => (drained = r));
}

// Presented frames straight from the compositor, next to the probe's main-thread view.
const ws = (tab as unknown as { ws: WebSocket }).ws;
let traceEvents: TraceEvent[] = [];
let traceDone: (() => void) | null = null;
ws.addEventListener('message', (e) => {
  const m = JSON.parse(String(e.data)) as { method?: string; params?: { value?: TraceEvent[] } };
  if (m.method === 'Tracing.dataCollected') traceEvents.push(...m.params!.value!);
  if (m.method === 'Tracing.tracingComplete') traceDone?.();
});
const CATEGORIES = ['benchmark', 'cc', 'viz', 'gpu', 'disabled-by-default-devtools.timeline.frame', 'devtools.timeline', 'blink.user_timing', 'input', 'latencyInfo'];

type Node = { id: number; callFrame: { functionName: string; url: string; lineNumber: number } };
function hotspots(profile: { nodes: Node[]; samples: number[]; timeDeltas: number[] }): string[] {
  const self = new Map<string, number>();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  for (const [i, id] of profile.samples.entries()) {
    const f = byId.get(id)!.callFrame;
    const k = `${f.functionName || '(anon)'} ${f.url.replace(/^.*\/(src|node_modules|assets)\//, '$1/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`;
    self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  }
  return [...self].toSorted((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${v.toFixed(0)}ms ${k}`);
}

for (let run = 1; run <= runs; run++) {
  traceEvents = [];
  if (profileOut) {
    await tab.send('Profiler.enable');
    await tab.send('Profiler.setSamplingInterval', { interval: 200 });
    await tab.send('Profiler.start');
  }
  await tab.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: CATEGORIES } });
  await tab.eval(`(() => { const p = window.__scape.zoomProbe; p.inject(${JSON.stringify(Injects[injectName] ?? null)}); p.start(); return 1; })()`);
  await play(stream);
  await Bun.sleep(700);
  const tr = await tab.eval<ZoomTrace>('(() => { const p = window.__scape.zoomProbe; const t = p.stop(); p.inject(null); return t; })()', 60_000);
  const traced = new Promise<void>((r) => (traceDone = r));
  await tab.send('Tracing.end');
  await traced;
  let hot: string[] | undefined;
  if (profileOut) {
    const { profile } = (await tab.send('Profiler.stop')) as { profile: Parameters<typeof hotspots>[0] };
    await Bun.write(profileOut.replace(/\.json$/, `-${sceneName}-${layersName}-${build}-${run}.cpuprofile`), JSON.stringify(profile));
    hot = hotspots(profile);
  }
  if (saveTo) await Bun.write(saveTo.replace(/\.json$/, `-${run}.json`), JSON.stringify(tr));
  const mark = traceEvents.find((e) => e.name === 'zoomprobe:start');
  // The mark's trace time against its performance.now time lines the two clocks up.
  const toUs = (t: number) => (mark ? mark.ts + (t - tr.meta.t0) * 1000 : 0);
  const lastInput = tr.wheel.at(-1)?.t ?? tr.meta.t0;
  const pipeline = pipelineFrames(traceEvents, toUs(tr.meta.t0), toUs(lastInput + 300));
  const zs = tr.frames.map((f) => f.z);
  const overflow = await tab.eval<boolean>('document.documentElement.scrollWidth > innerWidth');
  const button = await tab.eval<boolean>(`(() => { const r = document.querySelector('[data-testid=zoomprobe]')?.getBoundingClientRect(); return !!r && r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`);
  console.log(
    JSON.stringify({
      scene: sceneName,
      layers: layersName,
      build,
      viewport: `${vw}x${vh}@${vdpr}`,
      stream: traceFile ? `trace:${traceFile.split('/').pop()}` : kind,
      inject: injectName || null,
      run,
      idle,
      ...analyze(tr),
      pipeline,
      ackMs: [0.5, 0.95].map((q) => Math.round(acks.toSorted((a, b) => a - b)[Math.floor(q * (acks.length - 1))] ?? 0)),
      zoom: zs.length ? [zs[0], Math.max(...zs), Math.min(...zs)].map((z) => +z.toFixed(2)) : [],
      overflow,
      button,
      ...(hot && { hot })
    })
  );
  await tab.eval(`(() => { ${MAP}.jumpTo(${camera}); return 1; })()`);
  await tab.eval(IDLE, 90_000);
}
if (shot) await tab.shot(shot);
tab.close();
