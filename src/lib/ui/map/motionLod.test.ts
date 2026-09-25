import { describe, expect, it } from 'vitest';
import { MOTION_HIDDEN_LAYERS, MOTION_LOD_RESTORE_MS, motionLodWanted, motionSwitch, type Timers } from './motionLod';

function fakeTimers() {
  let now = 0;
  let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set: (fn, ms) => (due.set(++seq, { at: now + ms, fn }), seq),
    clear: (h) => void due.delete(h as number)
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [h, t] of [...due].toSorted((a, b) => a[1].at - b[1].at)) {
      if (t.at > now) continue;
      due.delete(h);
      t.fn();
    }
  };
  return { timers, advance, pending: () => due.size };
}

function rig() {
  const t = fakeTimers();
  const log: string[] = [];
  const sw = motionSwitch(() => log.push('lower'), () => log.push('raise'), MOTION_LOD_RESTORE_MS, t.timers);
  return { ...t, log, sw };
}

describe('motionLodWanted', () => {
  it('wants user moves on a canvas 2500 px or wider', () => {
    expect(motionLodWanted(2500, true)).toBe(true);
    expect(motionLodWanted(3309, true)).toBe(true);
  });
  it('leaves narrower canvases alone', () => {
    expect(motionLodWanted(2499, true)).toBe(false);
    expect(motionLodWanted(1400, true)).toBe(false);
  });
  it('leaves programmatic moves alone', () => {
    expect(motionLodWanted(3309, false)).toBe(false);
  });
});

describe('motionSwitch', () => {
  it('lowers on a wanted start and raises after the quiet time', () => {
    const { sw, log, advance } = rig();
    sw.start(true);
    expect(log).toEqual(['lower']);
    sw.end();
    advance(MOTION_LOD_RESTORE_MS - 1);
    expect(log).toEqual(['lower']);
    advance(1);
    expect(log).toEqual(['lower', 'raise']);
    expect(sw.low).toBe(false);
  });

  it('does nothing for an unwanted start', () => {
    const { sw, log, advance, pending } = rig();
    sw.start(false);
    sw.end();
    advance(1000);
    expect(log).toEqual([]);
    expect(pending()).toBe(0);
  });

  it('does not flip on a stream of wheel ticks', () => {
    const { sw, log, advance } = rig();
    for (let i = 0; i < 20; i++) {
      sw.start(true);
      advance(16);
      sw.end();
      advance(MOTION_LOD_RESTORE_MS - 20);
    }
    expect(log).toEqual(['lower']);
    advance(20);
    expect(log).toEqual(['lower', 'raise']);
  });

  it('keeps a pending raise off while an unwanted move runs', () => {
    const { sw, log, advance } = rig();
    sw.start(true);
    sw.end();
    sw.start(false);
    advance(1000);
    expect(log).toEqual(['lower']);
    sw.end();
    advance(MOTION_LOD_RESTORE_MS);
    expect(log).toEqual(['lower', 'raise']);
  });

  it('restarts the quiet time on each end', () => {
    const { sw, log, advance, pending } = rig();
    sw.start(true);
    sw.end();
    advance(100);
    sw.end();
    expect(pending()).toBe(1);
    advance(100);
    expect(log).toEqual(['lower']);
    advance(MOTION_LOD_RESTORE_MS - 100);
    expect(log).toEqual(['lower', 'raise']);
  });

  it('flush raises at once and cancels the timer', () => {
    const { sw, log, advance, pending } = rig();
    sw.start(true);
    sw.end();
    sw.flush();
    expect(log).toEqual(['lower', 'raise']);
    expect(pending()).toBe(0);
    advance(1000);
    sw.flush();
    expect(log).toEqual(['lower', 'raise']);
  });
});

describe('MOTION_HIDDEN_LAYERS', () => {
  it('has no duplicates', () => {
    expect(new Set(MOTION_HIDDEN_LAYERS).size).toBe(MOTION_HIDDEN_LAYERS.length);
  });
  it('never lists app layers', () => {
    const app = ['daynight-fill', 'daynight-line', 'elevation-tint', 'slope-tint', 'aspect-tint', 'heat', 'hillshade', 'building', 'building-3d', 'buildings'];
    for (const id of app) expect(MOTION_HIDDEN_LAYERS).not.toContain(id);
  });
});
