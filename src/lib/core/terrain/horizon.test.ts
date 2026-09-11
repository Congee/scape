import { describe, expect, it } from 'vitest';
import type { DemSource, DemTile } from './dem';
import { horizonAngleAt, planSweep, requiredTiles, sweepHorizon, type HorizonProfile } from './horizon';
import { TILE_SIZE, tileKey, tilePixelToLngLat } from './tiles';

const pin = { lng: -74.1553, lat: 40.7463 };

/** Synthetic DEM: a 600 m plateau starting 0.02° east of the pin, shallow sea elsewhere. */
function plateauSource(): DemSource {
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
            elev[py * TILE_SIZE + px] = p.lng > pin.lng + 0.02 ? 600 : -30;
          }
        t = { z, x, y, size: TILE_SIZE, elev };
        tiles.set(k, t);
      }
      return t;
    }
  };
}

describe('planSweep', () => {
  const plan = planSweep(pin, 20_000, { azStepDeg: 10 });

  it('marches outward with coarser zooms further away', () => {
    expect(plan.nAz).toBe(36);
    const [s, e] = [plan.start[0], plan.start[1]];
    expect(plan.distM[s]).toBe(50);
    expect(plan.distM[e - 1]).toBeLessThanOrEqual(20_000);
    for (let j = s + 1; j < e; j++) {
      expect(plan.distM[j]).toBeGreaterThan(plan.distM[j - 1]);
      expect(plan.zoom[j]).toBeLessThanOrEqual(plan.zoom[j - 1]);
    }
    expect(plan.zoom[s]).toBe(14);
    expect(plan.zoom[e - 1]).toBeLessThan(14);
  });

  it('lists every tile it will touch', () => {
    const tiles = requiredTiles(plan);
    expect(tiles.length).toBeGreaterThan(4);
    for (const t of tiles) {
      expect(t.z).toBeGreaterThanOrEqual(8);
      expect(t.z).toBeLessThanOrEqual(14);
    }
  });
});

describe('sweepHorizon', () => {
  it('finds the plateau to the east and the sea horizon elsewhere', () => {
    const plan = planSweep(pin, 5_000, { azStepDeg: 10 });
    const h = sweepHorizon(plateauSource(), plan, 1.6, 1.6, 5_000);
    const east = horizonAngleAt(h, 90);
    expect(east).toBeGreaterThan(15);
    expect(east).toBeLessThan(25);
    expect(h.distM[9]).toBeGreaterThan(1_500);
    expect(h.distM[9]).toBeLessThan(1_900);
    const west = horizonAngleAt(h, 270);
    expect(west).toBeLessThan(0);
    expect(west).toBeGreaterThan(-0.1);
    expect(horizonAngleAt(h, 0)).toBeLessThan(0);
  });
});

describe('horizonAngleAt', () => {
  it('interpolates and wraps around north', () => {
    const h: HorizonProfile = { azStepDeg: 90, angleDeg: new Float32Array([0, 10, 20, 30]), distM: new Float32Array(4), rangeM: 0 };
    expect(horizonAngleAt(h, 45)).toBeCloseTo(5);
    expect(horizonAngleAt(h, 315)).toBeCloseTo(15);
    expect(horizonAngleAt(h, 360)).toBeCloseTo(0);
    expect(horizonAngleAt(h, -90)).toBeCloseTo(30);
  });
});
