// Map zoom traces: what the probe records, realistic trackpad streams to replay, and the metrics that match what a zoom feels like.
// No imports, so the smoke scripts can load it under Bun as is.

/** One wheel event: `t` is its event timestamp, `at` when the page handled it (both performance.now ms). */
export type WheelSample = { t: number; at: number; dy: number; dx: number; mode: number; ctrl: boolean; shift: boolean };
/** One MapLibre render: `t` the frame's vsync time, `start`/`end` around the render, `z` the zoom it drew, `ty` MapLibre's wheel-or-trackpad guess. */
export type FrameSample = { t: number; start: number; end: number; z: number; ty?: string | null };
/** A long animation frame; `render` and `layout` are offsets of its rendering and style-and-layout phases. */
export type LoafSample = { t: number; d: number; block: number; render?: number; layout?: number; scripts: { d: number; inv: string; src: string; st?: number }[] };
export type ZoomTrace = {
  version: 1;
  meta: { ua: string; url: string; dpr: number; viewport: [number, number]; startedAt: string; t0: number; inject?: string };
  wheel: WheelSample[];
  frames: FrameSample[];
  /** Every rAF timestamp while recording: the display's cadence. */
  vsync: number[];
  loaf: LoafSample[];
  long: { t: number; d: number }[];
};

/** A replayable wheel event, `dt` ms after the stream starts. */
export type StreamEvent = { dt: number; dy: number; ctrl: boolean };

export const StreamKind = { Pinch: 'pinch', Scroll: 'scroll', Flick: 'flick' } as const;
export type StreamKind = (typeof StreamKind)[keyof typeof StreamKind];

/** MapLibre's trackpad rate: a frame's summed deltaY `d` scales the map by 2 / (1 + e^(-|d|/100)). */
export function zoomForDelta(d: number): number {
  if (!d) return 0;
  return -Math.sign(d) * Math.log2(2 / (1 + Math.exp(-Math.abs(d) / 100)));
}

/** deltaY in pixels, as MapLibre reads it: lines are 40 px, shift slows by 4. */
export function wheelPixels(w: Pick<WheelSample, 'dy' | 'mode' | 'shift'>): number {
  const px = w.mode === 1 ? w.dy * 40 : w.dy;
  return w.shift ? px / 4 : px;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2 ** 32;
  };
}

/**
 * A trackpad gesture as Chrome on macOS delivers it: events at the trackpad's rate with timing jitter, small fractional deltas.
 * Pinch: ctrl-wheel, deltaY = -100 ln(scale step), smooth in and out with still pauses. Scroll: two-finger swipes that
 * accelerate, lift and coast on a momentum tail. Flick: fast 60 Hz swipes whose first deltas are already large.
 * `zooms` is the net zoom each phase asks for at MapLibre's trackpad rate; phases alternate in, out (twice as far), in.
 */
export function trackpadStream(kind: StreamKind, { hz = 120, seed = 1, zooms = 2 } = {}): StreamEvent[] {
  const rand = rng(seed);
  const out: StreamEvent[] = [];
  const period = 1000 / hz;
  let t = 0;
  const jitter = () => period * (0.85 + 0.3 * rand());
  // Pixels per zoom level at MapLibre's trackpad rate, for small per-frame deltas.
  const pxPerZoom = 200 * Math.LN2;
  const phases = [-zooms, 2 * zooms, -zooms];
  for (const [i, z] of phases.entries()) {
    const sign = Math.sign(z);
    const px = Math.abs(z) * pxPerZoom;
    if (kind === StreamKind.Pinch) {
      // Velocity is a sine bump, so the pinch eases in and out like fingers do.
      const n = Math.round((700 + 200 * rand()) / period);
      const bump = Array.from({ length: n }, (_, k) => Math.sin((Math.PI * (k + 0.5)) / n));
      const sum = bump.reduce((a, b) => a + b, 0);
      for (const b of bump) {
        t += jitter();
        out.push({ dt: t, dy: sign * (px * b * (0.9 + 0.2 * rand())) / sum, ctrl: true });
      }
    } else {
      const flick = kind === StreamKind.Flick;
      const p = flick ? 1000 / 60 : period;
      const decay = flick ? 0.93 : 0.965;
      // Split the swipe's travel between the fingers-down ramp and the momentum tail.
      const ramp = flick ? 6 : Math.round(220 / p);
      const shape = Array.from({ length: ramp }, (_, k) => (flick ? 0.8 + (0.2 * k) / ramp : 0.15 + (0.85 * (k + 1)) / ramp));
      const tail: number[] = [];
      for (let v = 1; v > 0.02; v *= decay) tail.push(v);
      const sum = shape.reduce((a, b) => a + b, 0) + tail.reduce((a, b) => a + b, 0);
      const unit = px / sum;
      for (const s of [...shape, ...tail]) {
        t += p * (0.85 + 0.3 * rand());
        const dy = sign * unit * s * (0.92 + 0.16 * rand());
        out.push({ dt: t, dy: Math.round(dy * 4) / 4 || sign * 0.25, ctrl: false });
      }
    }
    // Fingers rest between phases; past MapLibre's 200 ms gesture end on the last ones.
    t += i === 0 ? 150 : 450;
  }
  return out;
}

const quantile = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const d = xs.toSorted((a, b) => a - b);
  return d[Math.min(d.length - 1, Math.floor(p * d.length))];
};
const round = (x: number, k = 1) => Math.round(x * 10 ** k) / 10 ** k;

export type ZoomMetrics = {
  /** Display period from rAF, ms. */
  periodMs: number;
  gestures: number;
  events: number;
  /** Wheel event timestamp to the end of the first render that moved the zoom its way, ms. */
  latencyP50: number;
  latencyP95: number;
  /** Worst first-event latency of a gesture: MapLibre's device guess can hold the first event back. */
  startMs: number;
  /** Time shift that best lines the drawn zoom up with the zoom the input asked for, ms. */
  lagMs: number;
  /** Mean zoom error left after that shift. */
  lagErr: number;
  /** Drawn zoom travel over the travel the input asked for; 1 is MapLibre's trackpad rate. */
  gain: number;
  /** Display frames that showed no new zoom although input, at the median latency, was due: missed and still renders. */
  stutter: number;
  stutterPct: number;
  /** Renders whose zoom step dwarfs their neighbours': catch-ups after a stall, easing restarts. */
  jumps: number;
  /** Gesture renders MapLibre drew on its eased mouse-wheel path, %. */
  easedPct: number;
  /** Long frames' time split, ms: script, rendering outside script (style, layout, paint), the rest. */
  loafSplit: [number, number, number];
  /** The old metric, for contrast: rAF interval p95 over the period, during gestures. */
  rafP95: number;
  renderP95: number;
  loaf: number;
  loafMax: number;
  loafTop: string[];
  long: number;
};

const EPS = 1e-6;
/** Events closer than this belong to one gesture. */
const GESTURE_GAP_MS = 300;

function loafSplit(ls: LoafSample[]): [number, number, number] {
  let script = 0;
  let render = 0;
  let total = 0;
  for (const l of ls) {
    const sc = l.scripts.reduce((a, x) => a + x.d, 0);
    script += sc;
    // Rendering minus the rAF scripts inside it, which count as script.
    if (l.render) render += l.d - l.render - l.scripts.reduce((a, x) => a + ((x.st ?? 0) >= l.render! ? x.d : 0), 0);
    total += l.d;
  }
  return [script, render, Math.max(0, total - script - render)].map(Math.round) as [number, number, number];
}

/** The zoom a trace's input asked for against what the map drew, frame by frame. */
export function analyze(tr: ZoomTrace): ZoomMetrics {
  const wheel = tr.wheel.filter((w) => w.dy !== 0).toSorted((a, b) => a.at - b.at);
  const frames = tr.frames.filter((f) => f.end > 0).toSorted((a, b) => a.start - b.start);
  const vs = tr.vsync.slice(1).map((v, i) => v - tr.vsync[i]);
  const periodMs = quantile(vs.filter((d) => d > 2), 0.5) || 1000 / 60;

  const gestures: { a: number; b: number; from: number; to: number }[] = [];
  for (const [i, w] of wheel.entries()) {
    const g = gestures.at(-1);
    if (g && w.at - wheel[g.b].at < GESTURE_GAP_MS) g.b = i;
    else gestures.push({ a: i, b: i, from: w.t, to: w.at });
  }
  // A gesture lasts until the map settles after its last event.
  for (const g of gestures) {
    g.to = wheel[g.b].at;
    for (const [i, f] of frames.entries()) {
      if (f.start <= g.to || f.start > g.to + 1000) continue;
      if (Math.abs(f.z - (frames[i - 1]?.z ?? f.z)) > EPS) g.to = f.end;
    }
  }
  const inGesture = (t: number) => gestures.some((g) => t >= g.from && t <= g.to + periodMs);

  // Per-frame input and drawn steps.
  let wi = 0;
  const steps: { f: FrameSample; dzIn: number; dzOut: number; since: number }[] = [];
  for (const [i, f] of frames.entries()) {
    let d = 0;
    let since = Infinity;
    while (wi < wheel.length && wheel[wi].at <= f.start) {
      since = Math.min(since, wheel[wi].t);
      d += wheelPixels(wheel[wi++]);
    }
    const prev = frames[i - 1];
    steps.push({ f, dzIn: zoomForDelta(d), dzOut: prev ? f.z - prev.z : 0, since });
  }

  let jumps = 0;
  const moving = steps.filter((s) => inGesture(s.f.t) && Math.abs(s.dzOut) > EPS);
  for (const [i, s] of moving.entries()) {
    const near = [moving[i - 2], moving[i - 1], moving[i + 1], moving[i + 2]].filter(Boolean).map((m) => Math.abs(m.dzOut));
    if (near.length && Math.abs(s.dzOut) > 0.01 && Math.abs(s.dzOut) > 2.5 * quantile(near, 0.5)) jumps++;
  }

  const lat: number[] = [];
  let startMs = 0;
  let fi = 0;
  for (const [i, w] of wheel.entries()) {
    const dir = -Math.sign(wheelPixels(w));
    while (fi < steps.length && steps[fi].f.start < w.at) fi++;
    const hit = steps.slice(fi).find((s) => Math.sign(s.dzOut) === dir && Math.abs(s.dzOut) > EPS);
    if (!hit) continue;
    const l = hit.f.end - w.t;
    lat.push(l);
    if (gestures.some((g) => g.a === i)) startMs = Math.max(startMs, l);
  }

  // Visible stalls: display frames between two zoom changes by which input should already have shown, at the median latency.
  const lat50 = quantile(lat, 0.5);
  let stutter = 0;
  let gestureVsyncs = 0;
  for (const g of gestures) gestureVsyncs += Math.max(1, Math.round((g.to - g.from) / periodMs));
  const changes = steps.filter((s) => inGesture(s.f.t) && Math.abs(s.dzOut) > EPS).map((s) => s.f);
  for (const [i, b] of changes.entries()) {
    const a = changes[i - 1];
    if (!a || b.t - a.t < 1.5 * periodMs) continue;
    // Input the page had not yet drawn at `a` whose usual latency put it on screen before `b`.
    if (wheel.some((w) => w.at > a.start && w.t + lat50 < b.t - periodMs)) stutter += Math.round((b.t - a.t) / periodMs) - 1;
  }

  // Input-implied zoom, as a step function of time, against the drawn zoom.
  const z0 = frames.find((f) => f.start >= (wheel[0]?.at ?? 0))?.z ?? frames[0]?.z ?? 0;
  const zBefore = frames.findLast((f) => f.start < (wheel[0]?.at ?? 0))?.z ?? z0;
  const cum: { t: number; z: number }[] = [];
  let zc = zBefore;
  for (const w of wheel) cum.push({ t: w.t, z: (zc += zoomForDelta(wheelPixels(w))) });
  const zIn = (t: number) => {
    let lo = 0;
    let hi = cum.length - 1;
    if (!cum.length || t < cum[0].t) return zBefore;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (cum[m].t <= t) lo = m;
      else hi = m - 1;
    }
    return cum[lo].z;
  };
  const sampled = frames.filter((f) => inGesture(f.t));
  let lagMs = 0;
  let lagErr = Infinity;
  for (let tau = 0; tau <= 500; tau += 2) {
    const e = sampled.reduce((a, f) => a + Math.abs(f.z - zIn(f.end - tau)), 0) / (sampled.length || 1);
    if (e < lagErr - 1e-9) [lagErr, lagMs] = [e, tau];
  }
  const travelIn = wheel.reduce((a, w) => a + Math.abs(zoomForDelta(wheelPixels(w))), 0);
  const travelOut = moving.reduce((a, s) => a + Math.abs(s.dzOut), 0);

  const gFrames = frames.filter((f) => inGesture(f.t));
  const rafIn = tr.vsync.slice(1).flatMap((v, i) => (inGesture(v) ? [v - tr.vsync[i]] : []));
  const loaf = tr.loaf.filter((l) => inGesture(l.t) || inGesture(l.t + l.d));
  const scripts = new Map<string, number>();
  for (const l of loaf) for (const s of l.scripts) scripts.set(`${s.inv} ${s.src}`, (scripts.get(`${s.inv} ${s.src}`) ?? 0) + s.d);
  return {
    periodMs: round(periodMs, 2),
    gestures: gestures.length,
    events: wheel.length,
    latencyP50: round(quantile(lat, 0.5)),
    latencyP95: round(quantile(lat, 0.95)),
    startMs: round(startMs),
    lagMs,
    lagErr: round(Number.isFinite(lagErr) ? lagErr : 0, 3),
    gain: round(travelIn ? travelOut / travelIn : 0, 2),
    stutter,
    stutterPct: round((100 * stutter) / (gestureVsyncs || 1)),
    jumps,
    easedPct: round((100 * gFrames.filter((f) => f.ty === 'wheel').length) / (gFrames.length || 1)),
    loafSplit: loafSplit(loaf.filter((l) => l.d > 50)),
    rafP95: round(quantile(rafIn, 0.95) / periodMs, 2),
    renderP95: round(quantile(frames.filter((f) => inGesture(f.t)).map((f) => f.end - f.start), 0.95)),
    loaf: loaf.filter((l) => l.d > 50).length,
    loafMax: Math.round(loaf.reduce((a, l) => Math.max(a, l.d), 0)),
    loafTop: [...scripts].toSorted((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${Math.round(v)}ms ${k}`),
    long: tr.long.filter((l) => inGesture(l.t)).length
  };
}

/** A Chrome trace event, as CDP Tracing delivers them. */
export type TraceEvent = { name: string; ph: string; pid: number; ts: number; args?: Record<string, unknown> };
export type FrameReport = { frames: number; presented: number; partial: number; dropped: number; droppedPct: number };

const STATE_RANK: Record<string, number> = { STATE_PRESENTED_ALL: 3, STATE_PRESENTED_PARTIAL: 2, STATE_DROPPED: 1, STATE_NO_UPDATE_DESIRED: 0 };

/** What the compositor put on screen from `fromUs` (trace clock) on: each frame's best report, forked or not, in the page's renderer. */
export function pipelineFrames(events: TraceEvent[], fromUs = 0, toUs = Infinity): FrameReport {
  const raf = new Map<number, number>();
  for (const e of events) if (e.name === 'FireAnimationFrame') raf.set(e.pid, (raf.get(e.pid) ?? 0) + 1);
  const pid = [...raf].toSorted((a, b) => b[1] - a[1])[0]?.[0];
  const best = new Map<number, string>();
  for (const e of events) {
    if (e.name !== 'PipelineReporter' || e.ph !== 'b' || e.pid !== pid || e.ts < fromUs || e.ts > toUs) continue;
    const r = e.args?.frame_reporter as { state?: string; frame_sequence?: number } | undefined;
    if (!r?.state || r.frame_sequence == null) continue;
    const cur = best.get(r.frame_sequence);
    if (cur == null || (STATE_RANK[r.state] ?? 0) > (STATE_RANK[cur] ?? 0)) best.set(r.frame_sequence, r.state);
  }
  const states = [...best.values()].filter((s) => s !== 'STATE_NO_UPDATE_DESIRED');
  const n = (s: string) => states.filter((x) => x === s).length;
  const dropped = n('STATE_DROPPED');
  return { frames: states.length, presented: n('STATE_PRESENTED_ALL'), partial: n('STATE_PRESENTED_PARTIAL'), dropped, droppedPct: round((100 * dropped) / (states.length || 1)) };
}
