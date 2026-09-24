// oxlint-disable no-underscore-dangle -- MapLibre's render loop and scrollZoom internals
import type { IControl, Map as MaplibreMap } from 'maplibre-gl';
import type { LoafSample, ZoomTrace } from './zoomTrace';

export type ZoomInject = { blockMs?: number; everyMs?: number; ease?: boolean };
export type ZoomProbe = {
  map: MaplibreMap;
  recording(): boolean;
  start(): void;
  stop(): ZoomTrace | null;
  /** Downloads a trace (default: the last one) as scape-zoom-<time>.json. */
  save(tr?: ZoomTrace | null): void;
  /** Deliberate stutter for validating the metrics: main-thread blocks, or MapLibre's eased wheel path. */
  inject(o: ZoomInject | null): void;
};

type Renderable = { _render: (t?: number) => unknown };
type ScrollZoomPrivate = { wheel: (e: WheelEvent) => void; _type: string | null };
type LoafEntry = PerformanceEntry & {
  blockingDuration: number;
  renderStart: number;
  styleAndLayoutStart: number;
  scripts: { startTime: number; duration: number; invoker: string; sourceURL: string; sourceFunctionName: string }[];
};

/** Records wheel input, rendered zoom, display cadence and long frames; costs nothing until `start`. */
export function installZoomProbe(map: MaplibreMap, withButton: boolean): () => void {
  const m = map as unknown as Renderable;
  let tr: ZoomTrace | null = null;
  let last: ZoomTrace | null = null;
  let stopFns: (() => void)[] = [];
  let injectOff: (() => void) | null = null;
  let injectName: string | undefined;

  const start = () => {
    if (tr) return;
    const cur: ZoomTrace = {
      version: 1,
      meta: {
        ua: navigator.userAgent,
        url: location.href,
        dpr: devicePixelRatio,
        viewport: [innerWidth, innerHeight],
        startedAt: new Date().toISOString(),
        t0: performance.now(),
        inject: injectName
      },
      wheel: [],
      frames: [],
      vsync: [],
      loaf: [],
      long: []
    };
    tr = cur;
    performance.mark('zoomprobe:start');
    const onWheel = (e: WheelEvent) =>
      cur.wheel.push({ t: e.timeStamp, at: performance.now(), dy: e.deltaY, dx: e.deltaX, mode: e.deltaMode, ctrl: e.ctrlKey, shift: e.shiftKey });
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    const sz = map.scrollZoom as unknown as ScrollZoomPrivate;
    const render = m._render;
    m._render = function (this: unknown, t?: number) {
      const s = performance.now();
      const r = render.call(this, t);
      cur.frames.push({ t: t ?? s, start: s, end: performance.now(), z: map.getZoom(), ty: sz._type });
      return r;
    };
    let raf = requestAnimationFrame(function tick(t) {
      cur.vsync.push(t);
      raf = requestAnimationFrame(tick);
    });
    const observers = [
      observe('long-animation-frame', (e) => {
        const l = e as LoafEntry;
        const s: LoafSample = {
          t: l.startTime,
          d: l.duration,
          block: l.blockingDuration,
          render: l.renderStart && l.renderStart - l.startTime,
          layout: l.styleAndLayoutStart && l.styleAndLayoutStart - l.startTime,
          scripts: []
        };
        for (const x of l.scripts) s.scripts.push({ d: x.duration, inv: x.invoker, src: `${x.sourceURL.split('/').pop()}:${x.sourceFunctionName}`, st: x.startTime - l.startTime });
        cur.loaf.push(s);
      }),
      observe('longtask', (e) => cur.long.push({ t: e.startTime, d: e.duration }))
    ];
    stopFns = [
      () => window.removeEventListener('wheel', onWheel, { capture: true }),
      () => (m._render = render),
      () => cancelAnimationFrame(raf),
      ...observers.map((o) => () => o?.disconnect())
    ];
  };

  const stop = () => {
    if (!tr) return null;
    for (const f of stopFns) f();
    stopFns = [];
    last = tr;
    tr = null;
    return last;
  };

  const save = (t: ZoomTrace | null = last) => {
    if (t) download(t);
  };

  const inject = (o: ZoomInject | null) => {
    injectOff?.();
    injectOff = null;
    injectName = undefined;
    if (!o) return;
    const offs: (() => void)[] = [];
    if (o.blockMs) {
      const id = setInterval(() => {
        const until = performance.now() + o.blockMs!;
        while (performance.now() < until);
      }, o.everyMs ?? 400);
      offs.push(() => clearInterval(id));
    }
    if (o.ease) {
      const sz = map.scrollZoom as unknown as ScrollZoomPrivate;
      const wheel = sz.wheel;
      sz.wheel = function (this: ScrollZoomPrivate, e: WheelEvent) {
        wheel.call(this, e);
        if (this._type === 'trackpad') this._type = 'wheel';
      };
      offs.push(() => (sz.wheel = wheel));
    }
    injectName = JSON.stringify(o);
    injectOff = () => offs.forEach((f) => f());
  };

  const probe: ZoomProbe = { map, recording: () => !!tr, start, stop, save, inject };
  const w = window as unknown as { __scape?: Record<string, unknown> };
  w.__scape ??= {};
  w.__scape.zoomProbe = probe;
  const control = withButton ? new RecordControl(probe) : null;
  if (control) map.addControl(control, 'top-right');
  return () => {
    stop();
    inject(null);
    if (control) map.removeControl(control);
    if (w.__scape?.zoomProbe === probe) delete w.__scape.zoomProbe;
  };
}

function download(t: ZoomTrace) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(t)], { type: 'application/json' }));
  a.download = `scape-zoom-${t.meta.startedAt.replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function observe(type: string, f: (e: PerformanceEntry) => void) {
  if (!PerformanceObserver.supportedEntryTypes.includes(type)) return null;
  const o = new PerformanceObserver((list) => list.getEntries().forEach(f));
  o.observe({ type });
  return o;
}

class RecordControl implements IControl {
  private el = document.createElement('div');
  constructor(private probe: ZoomProbe) {}
  onAdd() {
    this.el.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.testid = 'zoomprobe';
    b.style.cssText = 'width:auto;padding:0 8px;font:600 11px system-ui;color:#333;';
    const label = () => {
      b.textContent = this.probe.recording() ? 'Stop & save' : 'Record zoom';
      b.title = this.probe.recording() ? 'Stop recording and download the zoom trace' : 'Record a zoom trace (wheel, frames, long frames)';
    };
    b.addEventListener('click', () => {
      if (this.probe.recording()) this.probe.save(this.probe.stop());
      else this.probe.start();
      label();
    });
    label();
    this.el.append(b);
    return this.el;
  }
  onRemove() {
    this.el.remove();
  }
}
