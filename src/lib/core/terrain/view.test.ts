import { describe, expect, it } from 'vitest';
import { elevationAngleDeg } from '@core/geo/geodesy';
import type { DemSource, DemTile } from './dem';
import { planSweep, refineHorizon } from './horizon';
import { peakSource } from './peakFixture';
import { TILE_SIZE, tileKey, tilePixelToLngLat } from './tiles';
import { assembleView, columnAt, occluded, refineView, surfaceAt, sweepView } from './view';

const pin = { lng: -74.1553, lat: 40.7463 };

/** Two walls due east of the camera (within 0.005° of its latitude): 100 m at 0.02–0.03° and 600 m beyond 0.06°; shallow sea elsewhere. */
function wallsSource(): DemSource {
  const tiles = new Map<string, DemTile>();
  return {
    get(z, x, y) {
      const k = tileKey(z, x, y);
      let t = tiles.get(k);
      if (!t) {
        const elev = new Float32Array(TILE_SIZE * TILE_SIZE);
        for (let py = 0; py < TILE_SIZE; py++)
          for (let px = 0; px < TILE_SIZE; px++) {
            const p = tilePixelToLngLat(z, x, y, px + 0.5, py + 0.5);
            const d = p.lng - pin.lng;
            const inBand = Math.abs(p.lat - pin.lat) < 0.005;
            elev[py * TILE_SIZE + px] = !inBand ? 0 : d > 0.06 ? 600 : d > 0.02 && d < 0.03 ? 100 : 0;
          }
        t = { z, x, y, size: TILE_SIZE, elev };
        tiles.set(k, t);
      }
      return t;
    }
  };
}

describe('sweepView', () => {
  const plan = planSweep(pin, 8_000, { azStepDeg: 1, azFromDeg: 60, azSpanDeg: 60 });
  const v = sweepView(wallsSource(), plan, 1.6, 1.6, 8_000, 0.02);

  it('covers the requested window', () => {
    expect(plan.nAz).toBe(61);
    expect(v.azFromDeg).toBe(60);
    expect(columnAt(v, 60)).toBe(0);
    expect(columnAt(v, 90)).toBe(30);
    expect(columnAt(v, 120)).toBe(60);
    expect(columnAt(v, 180)).toBe(-1);
  });

  it('stacks the near wall under the far wall looking east', () => {
    const col = columnAt(v, 90);
    const [s, e] = [v.start[col], v.start[col + 1]];
    for (let m = s + 1; m < e; m++) expect(v.angleDeg[m]).toBeGreaterThan(v.angleDeg[m - 1]);
    expect(v.skylineDeg[col]).toBeGreaterThan(6);
    expect(v.skylineDeg[col]).toBeLessThan(7.5);
    expect(v.skylineDistM[col]).toBeGreaterThan(5_000);
    // 5° up is the far wall, 2° up the near wall, 8° is sky.
    expect(v.distM[surfaceAt(v, col, 5)]).toBeGreaterThan(5_000);
    const near = surfaceAt(v, col, 2);
    expect(v.distM[near]).toBeGreaterThan(1_500);
    expect(v.distM[near]).toBeLessThan(2_700);
    expect(surfaceAt(v, col, 8)).toBe(-1);
  });

  it('sees only sea toward the window edges', () => {
    const col = columnAt(v, 60);
    expect(v.skylineDeg[col]).toBeLessThan(0);
    expect(v.skylineDeg[col]).toBeGreaterThan(-0.1);
    expect(surfaceAt(v, col, -1)).toBeGreaterThanOrEqual(v.start[col]);
  });

  it('hides what stands behind a wall but not what peeks over it', () => {
    expect(occluded(v, 90, 4, 7_000)).toBe(true);
    expect(occluded(v, 90, 4, 3_000)).toBe(false);
    expect(occluded(v, 90, 2, 4_000)).toBe(true);
    expect(occluded(v, 90, 7, 7_500)).toBe(false);
  });
});

const cols = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

describe('assembleView', () => {
  const src = wallsSource();
  const sweep = (ks: number[]) => sweepView(src, planSweep(pin, 8_000, { azStepDeg: 1, columns: ks }), 1.6, 1.6, 8_000, 0.02);

  it('matches a whole sweep when a pan keeps half the columns', () => {
    const whole = sweep(cols(80, 21));
    const old = sweep(cols(70, 21));
    const fresh = sweep(cols(91, 10));
    const v = assembleView(1, 80, 21, 8_000, (k) => (k < 91 ? { v: old, col: k - 70 } : { v: fresh, col: k - 91 }));
    expect(v).toEqual(whole);
    expect(v.azFromDeg).toBe(80);
  });
});

describe('refineView', () => {
  const eyeM = 1.6;
  for (const km of [10, 50]) {
    it(`recovers a summit ${km} km away and matches the refined horizon`, () => {
      const src = peakSource(pin, km * 1000, 400, 1000);
      const truth = elevationAngleDeg(km * 1000, 400 - eyeM);
      const plan = planSweep(pin, 60_000, { azFromDeg: 88, azSpanDeg: 4, azStepDeg: 0.5 });
      const r = refineView(src, plan, eyeM, eyeM, 60_000, 0.02);
      const east = (90 - 88) / 0.5;
      const fine = r.sweep(src);
      expect(r.coarse).toEqual(sweepView(src, plan, eyeM, eyeM, 60_000, 0.02));
      expect(truth - r.coarse.skylineDeg[east]).toBeGreaterThan(0.02);
      expect(Math.abs(truth - fine.skylineDeg[east])).toBeLessThan(0.01);
      expect(fine.skylineDeg).toEqual(refineHorizon(src, plan, eyeM, eyeM, 60_000).sweep(src).angleDeg);
      // Layers still climb outward, and the top one is the skyline.
      for (let i = 0; i < fine.nAz; i++) {
        for (let m = fine.start[i] + 1; m < fine.start[i + 1]; m++) {
          expect(fine.angleDeg[m]).toBeGreaterThan(fine.angleDeg[m - 1]);
          expect(fine.distM[m]).toBeGreaterThan(fine.distM[m - 1]);
        }
        expect(fine.angleDeg[fine.start[i + 1] - 1]).toBe(fine.skylineDeg[i]);
      }
      // A mark just under the summit hides behind it, one just over clears it.
      expect(occluded(fine, 90, truth - 0.01, km * 2000)).toBe(true);
      expect(occluded(fine, 90, truth + 0.01, km * 2000)).toBe(false);
    });
  }

  it('keeps the layers under the skyline', () => {
    const plan = planSweep(pin, 8_000, { azStepDeg: 1, azFromDeg: 60, azSpanDeg: 60 });
    const r = refineView(wallsSource(), plan, 1.6, 1.6, 8_000, 0.02);
    const v = r.sweep(wallsSource());
    const col = columnAt(v, 90);
    expect(v.distM[surfaceAt(v, col, 2)]).toBeLessThan(2_700);
    expect(v.distM[surfaceAt(v, col, 5)]).toBeGreaterThan(5_000);
  });

  it('leaves flat ground alone', () => {
    const plan = planSweep(pin, 20_000, { azStepDeg: 10 });
    const flat: DemSource = { get: (z, x, y) => ({ z, x, y, size: TILE_SIZE, elev: new Float32Array(TILE_SIZE * TILE_SIZE) }) };
    const r = refineView(flat, plan, 1.6, 1.6, 20_000);
    expect(r.samples).toBe(0);
    expect(r.tiles).toEqual([]);
    expect(r.sweep(flat)).toEqual(sweepView(flat, plan, 1.6, 1.6, 20_000));
  });
});
