// map-zoom.ts for Firefox: replays a trackpad stream (or a ?zoomprobe trace) through WebDriver BiDi wheel actions and scores what the map drew.
/* oxlint-disable no-await-in-loop -- input is paced one event at a time */
// Usage: bun scripts/smoke/map-zoom-firefox.ts <bidi-port> <port> <scene> <layers> [--stream pinch|scroll|flick] [--trace scape-zoom.json]
//   [--viewport WxH[@dpr]] [--inject block|ease] [--seed n] [--zooms n] [--runs n] [--depth n] [--shot <out.png>] [--save <trace.json>]
// Needs remote.events.async.wheel.enabled, so wheel events go through the widget and APZ as a trackpad's do. Prints one JSON line per run.
import { analyze, StreamKind, trackpadStream, wheelPixels, type StreamEvent, type ZoomTrace } from '../../src/lib/ui/map/zoomTrace';
import { BidiTab } from './bidi';
import { DEFAULTS, Injects, Layers, Scenes, sceneUrl } from './map-zoom-scenes';

const args = process.argv.slice(2);
const [bidi = '9430', port = '5430', sceneName = 'hoboken', layersName = 'default'] = args;
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const runs = Number(opt('--runs', '1'));
const shot = args.includes('--shot') ? opt('--shot', '') : null;
const saveTo = args.includes('--save') ? opt('--save', '') : null;
const traceFile = args.includes('--trace') ? opt('--trace', '') : null;
const kind = opt('--stream', StreamKind.Pinch) as StreamKind;
const injectName = opt('--inject', '');
const depth = Number(opt('--depth', '2'));

const scene = Scenes[sceneName];
const layers = Layers[layersName];
if (!scene || !layers) throw new Error(`unknown scene ${sceneName} or layers ${layersName}`);
if (injectName && !Injects[injectName]) throw new Error(`unknown inject ${injectName}`);

let stream: StreamEvent[];
if (traceFile) {
  const tr = (await Bun.file(traceFile).json()) as ZoomTrace;
  const w = tr.wheel.filter((e) => e.dy);
  stream = w.map((e) => ({ dt: e.t - w[0].t, dy: wheelPixels(e), ctrl: e.ctrl }));
} else stream = trackpadStream(kind, { seed: Number(opt('--seed', '1')), zooms: Number(opt('--zooms', '1.5')) });

const tab = await BidiTab.open(Number(bidi));
try {
  const vp = opt('--viewport', '');
  if (vp) {
    const [w, h, dpr] = vp.split(/[x@]/).map(Number);
    await tab.send('browsingContext.setViewport', { context: tab.context, viewport: { width: w, height: h }, devicePixelRatio: dpr || null });
  } else await tab.send('browsingContext.setViewport', { context: tab.context, viewport: null, devicePixelRatio: null });
  const url = sceneUrl(`http://localhost:${port}`, scene);
  await tab.navigate(url);
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
  const env = await tab.eval<{ dpr: number; w: number; h: number; canvas: [number, number] }>(
    '(() => { const c = document.querySelector(".map canvas"); return { dpr: devicePixelRatio, w: innerWidth, h: innerHeight, canvas: [c.width, c.height] }; })()'
  );
  const box = await tab.eval<{ x: number; y: number }>('(() => { const r = document.querySelector(".map canvas").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()');

  const CONTROL = '\uE009';
  const acks: number[] = [];
  async function play(events: StreamEvent[]) {
    const t0 = performance.now();
    // A couple of actions in flight, the rest merged while they wait, like a trackpad's coalesced deltas.
    type Wheel = { dy: number; ctrl: boolean };
    let inflight = 0;
    let ctrl = false;
    const waiting: Wheel[] = [];
    let drained: (() => void) | null = null;
    let failed: unknown = null;
    const send = (w: Wheel) => {
      const s = performance.now();
      inflight++;
      // The key source's state carries over between calls, so ctrl only changes at a gesture's edges.
      const keys = w.ctrl === ctrl ? [{ type: 'pause', duration: 0 }] : [{ type: w.ctrl ? 'keyDown' : 'keyUp', value: CONTROL }];
      ctrl = w.ctrl;
      void tab
        .send('input.performActions', {
          context: tab.context,
          actions: [
            { type: 'key', id: 'kb', actions: [...keys, { type: 'pause', duration: 0 }] },
            { type: 'wheel', id: 'wh', actions: [{ type: 'pause', duration: 0 }, { type: 'scroll', x: box.x, y: box.y, deltaX: 0, deltaY: w.dy, duration: 0 }] }
          ]
        })
        .catch((e: unknown) => (failed ??= e))
        .then(() => {
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
      const w = { dy: e.dy, ctrl: e.ctrl };
      const last = waiting.at(-1);
      if (inflight < depth) send(w);
      else if (last?.ctrl === w.ctrl) last.dy += w.dy;
      else waiting.push(w);
    }
    if (inflight) await new Promise<void>((r) => (drained = r));
    if (failed) throw failed;
    await tab.send('input.releaseActions', { context: tab.context });
  }

  for (let run = 1; run <= runs; run++) {
    await tab.eval(`(() => { const p = window.__scape.zoomProbe; p.inject(${JSON.stringify(Injects[injectName] ?? null)}); p.start(); return 1; })()`);
    await play(stream);
    await Bun.sleep(700);
    const tr = await tab.eval<ZoomTrace>('(() => { const p = window.__scape.zoomProbe; const t = p.stop(); p.inject(null); return t; })()', 60_000);
    if (saveTo) await Bun.write(saveTo.replace(/\.json$/, `-${run}.json`), JSON.stringify(tr));
    const zs = tr.frames.map((f) => f.z);
    const overflow = await tab.eval<boolean>('document.documentElement.scrollWidth > innerWidth');
    const button = await tab.eval<boolean>(`(() => { const r = document.querySelector('[data-testid=zoomprobe]')?.getBoundingClientRect(); return !!r && r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`);
    console.log(
      JSON.stringify({
        browser: 'firefox',
        scene: sceneName,
        layers: layersName,
        build,
        viewport: `${env.w}x${env.h}@${+env.dpr.toFixed(3)}`,
        canvas: env.canvas.join('x'),
        stream: traceFile ? `trace:${traceFile.split('/').pop()}` : kind,
        inject: injectName || null,
        run,
        idle,
        ...analyze(tr),
        ackMs: [0.5, 0.95].map((q) => Math.round(acks.toSorted((a, b) => a - b)[Math.floor(q * (acks.length - 1))] ?? 0)),
        wheelIn: tr.wheel.length,
        zoom: zs.length ? [zs[0], Math.max(...zs), Math.min(...zs)].map((z) => +z.toFixed(2)) : [],
        overflow,
        button
      })
    );
    acks.length = 0;
    await tab.eval(`(() => { ${MAP}.jumpTo(${camera}); return 1; })()`);
    await tab.eval(IDLE, 90_000);
  }
  if (shot) await tab.shot(shot);
} finally {
  await tab.close();
}
