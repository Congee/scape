import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AltitudeRef, type SavedModel } from '@core/model';
import { groundKey, groundRefresher } from './modelGround';

const ring = (dx: number): [number, number][] => [
  [dx, 0],
  [dx + 1, 0],
  [dx + 1, 1]
];
const model = (dx: number, altRef: AltitudeRef = AltitudeRef.Ground, groundM = 10): SavedModel =>
  ({ id: 'a', anchor: { lng: dx, lat: 0, altRef, altM: 0, headingDeg: 0, scale: 1 }, footprint: ring(dx), groundM }) as unknown as SavedModel;

/** A store of one model, and ground reads the test resolves by hand. */
function harness(start: SavedModel) {
  let cur: SavedModel | undefined = start;
  const reads: { footprint: [number, number][]; done: (g: number | null) => void }[] = [];
  const applied: number[] = [];
  const refresh = groundRefresher({
    resolve: (footprint) => new Promise((done) => reads.push({ footprint, done })),
    current: () => cur,
    apply: async (m, groundM) => {
      applied.push(groundM);
      cur = { ...m, groundM };
    },
    delayMs: 250
  });
  return { refresh, reads, applied, set: (m: SavedModel | undefined) => (cur = m), get: () => cur };
}

describe('groundKey', () => {
  it('follows the footprint of Ground models only', () => {
    expect(groundKey(model(0))).toBe(groundKey(model(0)));
    expect(groundKey(model(0))).not.toBe(groundKey(model(1)));
    expect(groundKey(model(0, AltitudeRef.Absolute))).toBeNull();
    expect(groundKey({ ...model(0), footprint: ring(0).slice(0, 2) })).toBeNull();
  });
});

describe('groundRefresher', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('coalesces a nudge burst into one read of the last footprint', async () => {
    const h = harness(model(0));
    for (let dx = 1; dx <= 5; dx++) {
      h.set(model(dx));
      h.refresh('a');
      // oxlint-disable-next-line no-await-in-loop -- one nudge per 100 ms
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(250);
    expect(h.reads.map((r) => r.footprint)).toEqual([ring(5)]);
    h.reads[0].done(500);
    await vi.runAllTimersAsync();
    expect(h.applied).toEqual([500]);
    expect(h.get()?.groundM).toBe(500);
  });

  it('drops a read whose footprint moved on, and reruns once after it', async () => {
    const h = harness(model(1));
    h.refresh('a');
    await vi.advanceTimersByTimeAsync(250);
    h.set(model(2));
    h.refresh('a');
    await vi.advanceTimersByTimeAsync(250);
    expect(h.reads).toHaveLength(1);
    h.reads[0].done(100);
    await vi.runAllTimersAsync();
    expect(h.applied).toEqual([]);
    expect(h.reads.map((r) => r.footprint)).toEqual([ring(1), ring(2)]);
    h.reads[1].done(200);
    await vi.runAllTimersAsync();
    expect(h.applied).toEqual([200]);
  });

  it('leaves Absolute models alone', async () => {
    const h = harness(model(1, AltitudeRef.Absolute));
    h.refresh('a');
    await vi.runAllTimersAsync();
    expect(h.reads).toHaveLength(0);
  });

  it('marks the ground unknown when the DEM is unreadable, and skips an unchanged value', async () => {
    const h = harness(model(1));
    h.refresh('a');
    await vi.runAllTimersAsync();
    h.reads[0].done(null);
    await vi.runAllTimersAsync();
    expect(h.applied).toEqual([NaN]);
    h.refresh('a');
    await vi.runAllTimersAsync();
    h.reads[1].done(null);
    await vi.runAllTimersAsync();
    expect(h.applied).toHaveLength(1);
  });
});
