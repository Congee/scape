import { describe, expect, it } from 'vitest';
import type { DemSource, DemTile } from './dem';
import { buildDetailBound, buildHeightBound, DETAIL_MAX_TILES, planDetailBound, RELIEF_PAD_POSTS } from './heightBound';
import { BLOCKS_PER_SIDE, blockSideM, samplePoint, type MeshView } from './mesh';
import { lngLatToTilePixel, metersPerPixel } from './tiles';

const PIN = { lat: 46.0207, lng: 7.7491 };
const ZOOM = 11;
const SIZE = 512;
const POST_M = metersPerPixel(PIN.lat, ZOOM, SIZE);
const ROOT = 4;

/** Tiles filled from a function of the post's own lng/lat, so a bound can be checked against the truth. */
function source(at: (lng: number, lat: number) => number): DemSource {
  const tiles = new Map<string, DemTile>();
  return {
    get(z, x, y) {
      const k = `${z}/${x}/${y}`;
      let t = tiles.get(k);
      if (!t) {
        const elev = new Float32Array(SIZE * SIZE);
        const n = 2 ** z;
        for (let py = 0; py < SIZE; py++)
          for (let px = 0; px < SIZE; px++) {
            const lng = ((x + (px + 0.5) / SIZE) / n) * 360 - 180;
            const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + (py + 0.5) / SIZE)) / n))) * 180) / Math.PI;
            elev[py * SIZE + px] = at(lng, lat);
          }
        t = { z, x, y, size: SIZE, elev };
        tiles.set(k, t);
      }
      return t;
    }
  };
}

/** Ground at an eye-relative point, by the same map the mesh samples through. */
const groundAt = (at: (lng: number, lat: number) => number, e: number, n: number) => {
  const p = samplePoint(PIN, e, n);
  return at(p.lng, p.lat);
};

describe('buildHeightBound', () => {
  it('brackets a slope everywhere inside every block it covers', () => {
    // A ramp in both axes, steep enough that a block spans hundreds of metres of it.
    const at = (lng: number, lat: number) => 3000 + (lng - PIN.lng) * 40_000 + (lat - PIN.lat) * 30_000;
    const bound = buildHeightBound(PIN, source(at), ZOOM, POST_M, ROOT);
    for (let level = 0; level <= ROOT; level++) {
      const half = (BLOCKS_PER_SIDE / 2) * 2 ** (ROOT - level);
      const s = blockSideM(level);
      for (const ix of [-half, -1, 0, half - 1])
        for (const iy of [-half, 0, half - 1]) {
          const { minM, maxM } = bound({ level, ix, iy });
          for (let u = 0; u <= 1; u += 0.25)
            for (let v = 0; v <= 1; v += 0.25) {
              const h = groundAt(at, (ix + u) * s, (iy + v) * s);
              expect(h).toBeLessThanOrEqual(maxM);
              expect(h).toBeGreaterThanOrEqual(minM);
            }
        }
    }
  });

  it('pads by the relief a coarse post can hide, so a ridge between posts cannot escape', () => {
    const bound = buildHeightBound(PIN, source(() => 800), ZOOM, POST_M, ROOT);
    const { minM, maxM } = bound({ level: 0, ix: 3, iy: -2 });
    expect(maxM).toBeCloseTo(800 + RELIEF_PAD_POSTS * POST_M, 6);
    expect(minM).toBeCloseTo(800 - RELIEF_PAD_POSTS * POST_M, 6);
  });

  it('clamps bathymetry to the datum, the way the mesh does', () => {
    const bound = buildHeightBound(PIN, source(() => -2000), ZOOM, POST_M, ROOT);
    expect(bound({ level: 2, ix: 0, iy: 0 }).maxM).toBeCloseTo(RELIEF_PAD_POSTS * POST_M, 6);
  });

  it('a coarse block is the envelope of the fine ones under it', () => {
    const at = (lng: number, lat: number) => 1000 + 500 * Math.sin((lng - PIN.lng) * 900) * Math.cos((lat - PIN.lat) * 900);
    const bound = buildHeightBound(PIN, source(at), ZOOM, POST_M, ROOT);
    const parent = bound({ level: 2, ix: 1, iy: -1 });
    let minM = Infinity;
    let maxM = -Infinity;
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const c = bound({ level: 1, ix: 2 + dx, iy: -2 + dy });
        minM = Math.min(minM, c.minM);
        maxM = Math.max(maxM, c.maxM);
      }
    expect(parent.minM).toBe(minM);
    expect(parent.maxM).toBe(maxM);
  });

  it('leaves a block unbounded where the DEM has no coverage, so it can never be coarsened away', () => {
    const hole = lngLatToTilePixel(PIN.lng, PIN.lat, ZOOM, 1);
    const full = source(() => 900);
    const holed: DemSource = { get: (z, x, y) => (x === hole.x && y === hole.y ? null : full.get(z, x, y)) };
    const bound = buildHeightBound(PIN, holed, ZOOM, POST_M, ROOT);
    expect(bound({ level: 0, ix: 0, iy: 0 })).toEqual({ minM: -Infinity, maxM: Infinity });
    // …and the gap propagates up the pyramid rather than being averaged away.
    expect(bound({ level: ROOT, ix: 0, iy: 0 })).toEqual({ minM: -Infinity, maxM: Infinity });
  });

  it('is unbounded outside the root square and above the root level', () => {
    const bound = buildHeightBound(PIN, source(() => 900), ZOOM, POST_M, ROOT);
    expect(bound({ level: ROOT + 1, ix: 0, iy: 0 }).maxM).toBe(Infinity);
    expect(bound({ level: ROOT, ix: BLOCKS_PER_SIDE / 2, iy: 0 }).maxM).toBe(Infinity);
  });
});

/** Wraps a source so a test can see whether the pyramid was rebuilt or served from the memo. */
function counted(inner: DemSource): DemSource & { calls: number } {
  const c = {
    calls: 0,
    get(z: number, x: number, y: number) {
      c.calls++;
      return inner.get(z, x, y);
    }
  };
  return c;
}

const PROBES: { level: number; ix: number; iy: number }[] = [
  { level: 0, ix: 0, iy: 0 },
  { level: 0, ix: -7, iy: 5 },
  { level: 2, ix: 1, iy: -1 },
  { level: ROOT, ix: 0, iy: -1 }
];

describe('buildHeightBound memoisation', () => {
  it('serves an identical pyramid for a repeat call, so a view change costs nothing', () => {
    const at = (lng: number, lat: number) => 1200 + (lng - PIN.lng) * 20_000 - (lat - PIN.lat) * 50_000;
    const src = counted(source(at));
    const first = buildHeightBound(PIN, src, ZOOM, POST_M, ROOT);
    const built = PROBES.map(first);
    const warm = src.calls;
    expect(warm).toBeGreaterThan(0);
    const second = buildHeightBound(PIN, src, ZOOM, POST_M, ROOT);
    expect(src.calls).toBe(warm);
    expect(PROBES.map(second)).toEqual(built);
  });

  it('rebuilds when the pin moves', () => {
    const src = counted(source((lng, lat) => 1200 + (lng - PIN.lng) * 20_000 - (lat - PIN.lat) * 50_000));
    buildHeightBound(PIN, src, ZOOM, POST_M, ROOT);
    const warm = src.calls;
    buildHeightBound({ lat: PIN.lat + 0.5, lng: PIN.lng + 0.5 }, src, ZOOM, POST_M, ROOT);
    expect(src.calls).toBeGreaterThan(warm);
  });

  it('rebuilds when the DEM gains the tile a hole was missing', () => {
    const hole = lngLatToTilePixel(PIN.lng, PIN.lat, ZOOM, 1);
    const full = source(() => 900);
    let loaded = false;
    const src = counted({ get: (z, x, y) => (!loaded && x === hole.x && y === hole.y ? null : full.get(z, x, y)) });
    expect(buildHeightBound(PIN, src, ZOOM, POST_M, ROOT)({ level: 0, ix: 0, iy: 0 })).toEqual({ minM: -Infinity, maxM: Infinity });
    loaded = true;
    expect(buildHeightBound(PIN, src, ZOOM, POST_M, ROOT)({ level: 0, ix: 0, iy: 0 }).maxM).toBeCloseTo(900 + RELIEF_PAD_POSTS * POST_M, 6);
  });
});

const DETAIL_ZOOM = 13;
const DETAIL_POST_M = metersPerPixel(PIN.lat, DETAIL_ZOOM, SIZE);

describe('buildDetailBound', () => {
  const ridge = (lng: number, lat: number) => 1500 + 600 * Math.sin((lng - PIN.lng) * 700) * Math.cos((lat - PIN.lat) * 500);

  it('brackets the relief inside every block it answers for, and tighter than the coarse pyramid', () => {
    const coarse = buildHeightBound(PIN, source(ridge), ZOOM, POST_M, ROOT);
    const detail = buildDetailBound(PIN, source(ridge), DETAIL_ZOOM, DETAIL_POST_M);
    let tighter = 0;
    for (const level of [0, 2, 4])
      for (const ix of [-3, 0, 2])
        for (const iy of [-2, 1]) {
          const b = { level, ix, iy };
          const d = detail(b);
          expect(d).not.toBeNull();
          const s = blockSideM(level);
          for (let u = 0; u <= 1; u += 0.125)
            for (let v = 0; v <= 1; v += 0.125) {
              const h = groundAt(ridge, (ix + u) * s, (iy + v) * s);
              expect(h).toBeLessThanOrEqual(d!.maxM);
              expect(h).toBeGreaterThanOrEqual(d!.minM);
            }
          if (d!.maxM - d!.minM < coarse(b).maxM - coarse(b).minM) tighter++;
        }
    expect(tighter).toBeGreaterThan(0);
  });

  it('pads by its own posts, and clamps water to the datum', () => {
    expect(buildDetailBound(PIN, source(() => 800), DETAIL_ZOOM, DETAIL_POST_M)({ level: 1, ix: 0, iy: 0 })).toEqual({
      minM: 800 - RELIEF_PAD_POSTS * DETAIL_POST_M,
      maxM: 800 + RELIEF_PAD_POSTS * DETAIL_POST_M
    });
    expect(buildDetailBound(PIN, source(() => -50), DETAIL_ZOOM, DETAIL_POST_M)({ level: 1, ix: 0, iy: 0 })!.maxM).toBeCloseTo(RELIEF_PAD_POSTS * DETAIL_POST_M, 6);
  });

  it('answers null where a tile is missing, so the coarse bound stands', () => {
    const full = source(() => 900);
    const hole = lngLatToTilePixel(PIN.lng, PIN.lat, DETAIL_ZOOM, 1);
    const holed: DemSource = { get: (z, x, y) => (x === hole.x && y === hole.y ? null : full.get(z, x, y)) };
    expect(buildDetailBound(PIN, holed, DETAIL_ZOOM, DETAIL_POST_M)({ level: 0, ix: 0, iy: 0 })).toBeNull();
  });
});

const wedge = (hfovDeg: number): MeshView => ({ azimuthDeg: 220, hfovDeg, vfovDeg: (hfovDeg * 2) / 3, pitchDeg: 0, elHalfDeg: hfovDeg / 3, targetRad: 1e-4 });

describe('planDetailBound', () => {

  it('buys the finest zoom whose tiles over the wedge fit the cap', () => {
    const narrow = planDetailBound(PIN, wedge(0.86), 100_000, 12, 14, SIZE);
    const wide = planDetailBound(PIN, wedge(20), 100_000, 12, 14, SIZE);
    expect(narrow).not.toBeNull();
    expect(narrow!.tiles.length).toBeLessThanOrEqual(DETAIL_MAX_TILES);
    expect(narrow!.zoom).toBeGreaterThan(wide?.zoom ?? 11);
    // Each planned tile is at the planned zoom and distinct.
    expect(new Set(narrow!.tiles.map((t) => `${t.z}/${t.x}/${t.y}`)).size).toBe(narrow!.tiles.length);
    for (const t of narrow!.tiles) expect(t.z).toBe(narrow!.zoom);
  });

  it('gives up rather than wait on more tiles than the cap', () => {
    expect(planDetailBound(PIN, wedge(120), 100_000, 14, 14, SIZE)).toBeNull();
  });
});
