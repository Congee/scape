import { describe, expect, it } from 'vitest';
import { analyze, pipelineFrames, StreamKind, trackpadStream, zoomForDelta, type StreamEvent, type ZoomTrace } from './zoomTrace';

const PERIOD = 1000 / 120;

/** A map that renders on vsync: trackpad-style steps, or eased toward the target like MapLibre's wheel path. */
function simulate(stream: StreamEvent[], { ease = false, blockMs = 0, everyMs = 400 } = {}): ZoomTrace {
  const tr: ZoomTrace = {
    version: 1,
    meta: { ua: '', url: '', dpr: 2, viewport: [1400, 900], startedAt: '', t0: 0 },
    wheel: [],
    frames: [],
    vsync: [],
    loaf: [],
    long: []
  };
  let z = 15;
  let target = z;
  let busy = 0;
  let nextBlock = everyMs;
  let ei = 0;
  const end = (stream.at(-1)?.dt ?? 0) + 800;
  for (let v = 0; v < end; v += PERIOD) {
    if (v < busy) continue;
    let d = 0;
    for (; ei < stream.length && stream[ei].dt <= v; ei++) {
      const e = stream[ei];
      tr.wheel.push({ t: e.dt, at: v + 0.1, dy: e.dy, dx: 0, mode: 0, ctrl: e.ctrl, shift: false });
      d += e.dy;
    }
    tr.vsync.push(v);
    target += zoomForDelta(d);
    const next = ease ? z + (target - z) * 0.2 : target;
    if (Math.abs(next - z) > 1e-7 || d) {
      z = Math.abs(target - next) < 1e-4 ? target : next;
      tr.frames.push({ t: v, start: v + 0.3, end: v + 1.5, z });
    }
    if (blockMs && v >= nextBlock) {
      busy = v + blockMs;
      nextBlock += everyMs;
      tr.loaf.push({ t: v, d: blockMs + 2, block: blockMs - 48, scripts: [{ d: blockMs, inv: 'TimerHandler:setInterval', src: 'probe' }] });
    }
  }
  return tr;
}

describe('zoomForDelta', () => {
  it('matches MapLibre trackpad scale for small deltas', () => {
    expect(zoomForDelta(-1)).toBeCloseTo(1 / (200 * Math.LN2), 4);
    expect(zoomForDelta(3)).toBeLessThan(0);
    expect(zoomForDelta(0)).toBe(0);
  });
});

describe('trackpadStream', () => {
  it('pinches with small ctrl deltas in, out, in', () => {
    const s = trackpadStream(StreamKind.Pinch, { seed: 3 });
    expect(s.every((e) => e.ctrl && Math.abs(e.dy) < 12)).toBe(true);
    const firstIn = s.filter((e) => e.dy < 0 && e.dt < 1200).reduce((a, e) => a + zoomForDelta(e.dy), 0);
    expect(firstIn).toBeGreaterThan(1.8);
    expect(firstIn).toBeLessThan(2.2);
    expect(Math.abs(s.reduce((a, e) => a + zoomForDelta(e.dy), 0))).toBeLessThan(0.3);
  });

  it('scrolls without ctrl and coasts on a momentum tail', () => {
    const s = trackpadStream(StreamKind.Scroll, { seed: 5 });
    expect(s.some((e) => e.ctrl)).toBe(false);
    const first = s.filter((e) => e.dy < 0);
    const peak = Math.max(...first.map((e) => -e.dy));
    expect(-first.at(-1)!.dy).toBeLessThan(peak / 10);
  });

  it('flicks at 60 Hz and is deterministic per seed', () => {
    const s = trackpadStream(StreamKind.Flick, { seed: 9 });
    expect(s[1].dt - s[0].dt).toBeGreaterThan(12);
    expect(trackpadStream(StreamKind.Flick, { seed: 9 })).toEqual(s);
  });
});

describe('analyze', () => {
  const pinch = trackpadStream(StreamKind.Pinch, { seed: 1 });

  it('sees a render-on-input map as smooth', () => {
    const m = analyze(simulate(pinch));
    expect(m.gestures).toBe(2);
    expect(m.stutter).toBe(0);
    expect(m.jumps).toBe(0);
    expect(m.lagMs).toBeLessThanOrEqual(10);
    expect(m.gain).toBeCloseTo(1, 1);
    expect(m.periodMs).toBeCloseTo(PERIOD, 1);
    expect(m.frameDt[2]).toBeLessThan(2 * PERIOD);
  });

  it('catches a periodic 30 ms block that rAF p95 misses', () => {
    const m = analyze(simulate(pinch, { blockMs: 30 }));
    expect(m.rafP95).toBeLessThan(1.1);
    expect(m.stutter).toBeGreaterThan(10);
    expect(m.jumps).toBeGreaterThan(2);
    expect(m.loaf).toBe(0);
    expect(m.loafMax).toBe(32);
    expect(m.frameDt[2]).toBeGreaterThan(30);
  });

  it('catches eased zoom as lag, not stutter', () => {
    const m = analyze(simulate(pinch, { ease: true }));
    expect(m.stutter).toBeLessThanOrEqual(2);
    expect(m.lagMs).toBeGreaterThan(20);
  });
});

const pr = (pid: number, ts: number, seq: number, state: string) => ({ name: 'PipelineReporter', ph: 'b', pid, ts, args: { frame_reporter: { state, frame_sequence: seq } } });

describe('pipelineFrames', () => {
  it('keeps the best report per frame in the renderer', () => {
    const ev = [
      { name: 'FireAnimationFrame', ph: 'X', pid: 2, ts: 0 },
      pr(1, 10, 1, 'STATE_DROPPED'),
      pr(2, 10, 1, 'STATE_PRESENTED_ALL'),
      pr(2, 11, 1, 'STATE_PRESENTED_PARTIAL'),
      pr(2, 20, 2, 'STATE_DROPPED'),
      pr(2, 30, 3, 'STATE_NO_UPDATE_DESIRED'),
      pr(2, 5, 0, 'STATE_DROPPED')
    ];
    expect(pipelineFrames(ev, 8)).toEqual({ frames: 2, presented: 1, partial: 0, dropped: 1, droppedPct: 50 });
  });
});
