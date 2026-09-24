import { describe, expect, it } from 'vitest';
import { ancestorTile, cubicStencilTiles, decodeTerrarium, findOutlierPosts, demRowAt, elevationAt, elevationAtCubic, lowestGroundAt, overzoomTile, sampleGridCubic, sampleTile, type DemSource, type DemTile, type RetainingDemSource } from './dem';
import { evictionKeys, Holds } from './holds';
import { tileKey, tilePixelToLngLat, type TileCoord } from './tiles';

describe('decodeTerrarium', () => {
  it('decodes known triplets', () => {
    const rgba = new Uint8ClampedArray([128, 0, 0, 255, 128, 1, 0, 255, 127, 255, 128, 255, 162, 139, 0, 255]);
    const { elev: e } = decodeTerrarium(rgba, 2);
    expect(e[0]).toBe(0);
    expect(e[1]).toBe(1);
    expect(e[2]).toBeCloseTo(-0.5, 6);
    expect(e[3]).toBe(8843);
  });
});

describe('sampleTile', () => {
  const tile: DemTile = { z: 0, x: 0, y: 0, size: 2, elev: new Float32Array([0, 10, 20, 30]) };

  it('interpolates bilinearly between pixel centres', () => {
    expect(sampleTile(tile, 1, 1)).toBeCloseTo(15);
    expect(sampleTile(tile, 0.5, 0.5)).toBeCloseTo(0);
    expect(sampleTile(tile, 1.5, 0.5)).toBeCloseTo(10);
    expect(sampleTile(tile, 1, 1.5)).toBeCloseTo(25);
  });

  it('clamps at the edges', () => {
    expect(sampleTile(tile, 0, 0)).toBe(0);
    expect(sampleTile(tile, 2, 2)).toBe(30);
  });

  it('reads through a DemSource and reports missing tiles as NaN', () => {
    const src: DemSource = { get: (z, x, y) => (z === 0 && x === 0 && y === 0 ? tile : undefined) };
    expect(elevationAt(src, 0, 0, 0)).toBeCloseTo(15);
    expect(elevationAt(src, 0, 0, 1)).toBeNaN();
  });
});

const rowTile = (x: number, base: number): DemTile => ({ z: 2, x, y: 1, size: 2, elev: new Float32Array([base, base + 1, base + 2, base + 3]) });

describe('demRowAt', () => {
  const tiles = new Map([
    [1, rowTile(1, 0)],
    [2, rowTile(2, 100)]
  ]);

  let gets = 0;
  const src: DemSource = {
    get: (z, x, y) => {
      gets++;
      return z === 2 && y === 1 ? tiles.get(x) : undefined;
    }
  };

  it('matches elevationAt across a row that crosses tiles', () => {
    const lat = 40;
    const lngs = Array.from({ length: 41 }, (_, i) => -90 + i * 4.5);
    const want = lngs.map((lng) => elevationAt(src, lng, lat, 2));
    gets = 0;
    const row = demRowAt(src, lat, 2);
    expect(lngs.map(row)).toStrictEqual(want);
    // Three tile columns span the row, so it resolves far fewer tiles than it samples.
    expect(gets).toBe(3);
  });

  it('reports a missing tile as NaN', () => {
    const row = demRowAt({ get: () => undefined }, 40, 2);
    expect(row(0)).toBeNaN();
  });
});

/** A 2x2 grid of 4-pixel tiles at z1, filled from a smooth field so slopes are meaningful. */
const FIELD = (gx: number, gy: number): number => 100 * Math.sin(gx / 3) + 60 * Math.cos(gy / 2.5) + 0.7 * gx * gy;
const SIZE = 4;

function fieldTile(x: number, y: number): DemTile {
  const elev = new Float32Array(SIZE * SIZE);
  for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) elev[j * SIZE + i] = FIELD(x * SIZE + i, y * SIZE + j);
  return { z: 1, x, y, size: SIZE, elev };
}

const fieldSrc = (have: (x: number, y: number) => boolean = () => true): DemSource => ({
  get: (z, x, y) => (z === 1 && x >= 0 && x < 2 && y >= 0 && y < 2 && have(x, y) ? fieldTile(x, y) : undefined)
});

/**
 * Gap between the one-sided slopes of `f` at `at`. A C0 interpolant leaves a jump the step size
 * does not touch; a C1 one leaves only the curvature over the step, which vanishes with it.
 */
function slopeJump(f: (g: number) => number, at: number, h: number): number {
  return Math.abs((f(at + h) - f(at)) / h - (f(at) - f(at - h)) / h);
}
const STEPS = [1e-3, 1e-4, 1e-5];

describe('sampleGridCubic', () => {
  const src = fieldSrc();
  const at = (gx: number, gy: number) => sampleGridCubic(src, 1, SIZE, gx, gy);

  it('reproduces every post exactly, so no measured elevation is invented away', () => {
    for (let gy = 0; gy < 2 * SIZE; gy++)
      for (let gx = 0; gx < 2 * SIZE; gx++) expect(at(gx + 0.5, gy + 0.5)).toBeCloseTo(FIELD(gx, gy), 3);
  });

  it('has a continuous slope across a post boundary, where the bilinear one kinks', () => {
    // Post 2 of tile (0, 0): both samplers are inside one tile there, so only the interpolant differs.
    const bilinear = (gx: number) => sampleTile(fieldTile(0, 0), gx, 1.5);
    for (const h of STEPS) {
      expect(slopeJump((gx) => at(gx, 1.5), 2.5, h)).toBeLessThan(20 * h);
      expect(slopeJump(bilinear, 2.5, h)).toBeGreaterThan(1);
    }
  });

  it('has a continuous slope across a tile boundary, on both axes', () => {
    // The per-tile bilinear sampler clamps at the border, so its slope jumps there whatever the step.
    const bilinear = (gx: number) => {
      const x = gx < SIZE ? 0 : 1;
      return sampleTile(fieldTile(x, 1), gx - x * SIZE, 1.2);
    };
    for (const h of STEPS) {
      expect(slopeJump((gx) => at(gx, 5.2), SIZE, h)).toBeLessThan(20 * h);
      expect(slopeJump((gy) => at(5.2, gy), SIZE, h)).toBeLessThan(20 * h);
      expect(slopeJump(bilinear, SIZE, h)).toBeGreaterThan(1);
    }
  });

  it('degrades to bilinear rather than seaming or NaN when a stencil neighbour is missing', () => {
    const holed = fieldSrc((x, y) => !(x === 1 && y === 1));
    const v = sampleGridCubic(holed, 1, SIZE, 2.5, 2.5);
    expect(v).toBeCloseTo(FIELD(2, 2), 3);
    // A point whose own four posts are gone stays NaN: missing is still missing.
    expect(sampleGridCubic(holed, 1, SIZE, 6.5, 6.5)).toBeNaN();
  });
});

describe('elevationAtCubic', () => {
  it('reads through a DemSource and reports a missing tile as NaN', () => {
    const src = fieldSrc();
    const lat = 20;
    const lng = 30;
    expect(elevationAtCubic(src, lng, lat, 1)).toBeCloseTo(elevationAt(src, lng, lat, 1), -1);
    expect(elevationAtCubic(src, lng, lat, 3)).toBeNaN();
  });
});

describe('cubicStencilTiles', () => {
  it('names every tile the stencil reads, so a caller that loads them never degrades to bilinear', () => {
    const full = fieldSrc();
    for (let i = 0; i <= 40; i++)
      for (let j = 0; j <= 40; j++) {
        const lng = -180 + (360 * i) / 40;
        const lat = 80 - (160 * j) / 40;
        const tiles = cubicStencilTiles(lng, lat, 1, SIZE);
        expect(tiles.length).toBeLessThanOrEqual(4);
        const keys = new Set(tiles.map((t) => `${t.x}/${t.y}`));
        const only: DemSource = { get: (z, x, y) => (keys.has(`${x}/${y}`) ? full.get(z, x, y) : undefined) };
        expect(elevationAtCubic(only, lng, lat, 1)).toBe(elevationAtCubic(full, lng, lat, 1));
      }
  });
});

const encode = (m: number) => {
  const u = Math.round((m + 32768) * 256);
  return [(u >> 16) & 0xff, (u >> 8) & 0xff, u & 0xff, 255];
};

describe('invalid DEM posts', () => {
  /** Mapzen 15/9650/12316: the last two pixel columns decode to -14941 m, the rest is ~8 m river flat. */
  const badTilePixels = (size: number) => {
    const px = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) px.set(encode(x >= size - 2 ? -14941 : 8), (y * size + x) * 4);
    return px;
  };

  it('repairs an out-of-envelope post from its neighbour instead of propagating it', () => {
    const px = new Uint8ClampedArray(16);
    px.set(encode(12), 0);
    px.set(encode(-14941), 4);
    px.set(encode(-32768), 8);
    px.set(encode(14), 12);
    const { elev, repaired } = decodeTerrarium(px, 2);
    expect(repaired).toBe(2);
    expect(Array.from(elev)).toEqual([12, 12, 12, 14]);
  });

  it('reports a tile with no valid post as fully repaired and unusable', () => {
    const px = new Uint8ClampedArray(16);
    for (let i = 0; i < 4; i++) px.set(encode(-32768), i * 4);
    const { elev, repaired } = decodeTerrarium(px, 2);
    expect(repaired).toBe(4);
    expect(elev.every(Number.isNaN)).toBe(true);
  });

  it('samples the repaired bad-column tile at the river flat, not a kilometre above it', () => {
    const size = 256;
    const z = 15;
    const { elev, repaired } = decodeTerrarium(badTilePixels(size), size);
    expect(repaired).toBe(size * 2);
    const bad: DemTile = { z, x: 9650, y: 12316, size, elev };
    const flat: Float32Array = new Float32Array(size * size).fill(8);
    const src: DemSource = { get: (zz, x, y) => (x === 9650 && y === 12316 ? bad : { z: zz, x, y, size, elev: flat }) };
    for (const gx of [9650 * 256 + 254, 9650 * 256 + 255, 9650 * 256 + 256])
      expect(sampleGridCubic(src, z, size, gx, 12316 * 256 + 128)).toBeCloseTo(8, 6);
  });

  it('keeps the cubic inside the envelope of its posts at a raw cliff', () => {
    const size = 256;
    const z = 15;
    const elev = new Float32Array(size * size).fill(8);
    for (let y = 0; y < size; y++) for (let x = size - 2; x < size; x++) elev[y * size + x] = -14941;
    const tile: DemTile = { z, x: 9650, y: 12316, size, elev };
    const flat = new Float32Array(size * size).fill(8);
    const src: DemSource = { get: (zz, x, y) => (x === 9650 && y === 12316 ? tile : { z: zz, x, y, size, elev: flat }) };
    for (let i = 0; i <= 80; i++) {
      const v = sampleGridCubic(src, z, size, 9650 * 256 + 250 + i / 10, 12316 * 256 + 128);
      expect(v).toBeLessThanOrEqual(8);
      expect(v).toBeGreaterThanOrEqual(-14941);
    }
  });
});

const field = (x: number, y: number) => 100 + 30 * Math.sin(x / 19) + 25 * Math.cos(y / 23) + 0.4 * x - 0.3 * y;
const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

describe('the cubic envelope clamp on smooth terrain', () => {
  const size = 64;
  const z = 0;
  const elev = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) elev[y * size + x] = field(x, y);
  const src: DemSource = { get: () => ({ z, x: 0, y: 0, size, elev }) };

  /** Reference reconstruction with no clamp, to show the clamp does not move smooth ground. */
  const unclamped = (gx: number, gy: number) => {
    const fx = gx - 0.5;
    const fy = gy - 0.5;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const at = (x: number, y: number) => elev[y * size + x];
    const row = (j: number) => cr(at(ix - 1, iy + j), at(ix, iy + j), at(ix + 1, iy + j), at(ix + 2, iy + j), fx - ix);
    return cr(row(-1), row(0), row(1), row(2), fy - iy);
  };

  it('is inert away from cliffs', () => {
    let worst = 0;
    for (let i = 0; i < 300; i++)
      for (let j = 0; j < 300; j++) {
        const gx = 2 + (i * 59) / 300;
        const gy = 2 + (j * 59) / 300;
        worst = Math.max(worst, Math.abs(sampleGridCubic(src, z, size, gx, gy) - unclamped(gx, gy)));
      }
    expect(worst).toBeLessThan(0.01);
  });

  it('reproduces a plane exactly, so C1 smoothness is untouched', () => {
    const plane = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) plane[y * size + x] = 5 + 0.7 * x - 0.9 * y;
    const flat: DemSource = { get: () => ({ z, x: 0, y: 0, size, elev: plane }) };
    for (let i = 0; i < 40; i++) {
      const gx = 3 + i * 1.37;
      const gy = 4 + i * 0.91;
      expect(sampleGridCubic(flat, z, size, gx, gy)).toBeCloseTo(5 + 0.7 * (gx - 0.5) - 0.9 * (gy - 0.5), 4);
    }
  });
});

const grid = (size: number, v = 23.5) => new Float32Array(size * size).fill(v);

describe('neighbourhood outlier posts', () => {
  const repair = (elev: Float32Array, size: number) => {
    const px = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < elev.length; i++) px.set(encode(elev[i]), i * 4);
    return decodeTerrarium(px, size, 4);
  };

  it('repairs an isolated spike to its neighbourhood', () => {
    const size = 8;
    const e = grid(size);
    e[3 * size + 4] = 942;
    const { elev, repaired } = repair(e, size);
    expect(repaired).toBe(1);
    expect(elev[3 * size + 4]).toBeCloseTo(23.5, 3);
  });

  it('fills a spike with the neighbourhood median, not with the nearest valid post', () => {
    const size = 8;
    const e = grid(size, 0);
    // The post above is what a nearest-valid fill would take, and it is nowhere near the median.
    e[2 * size + 4] = 40;
    e[3 * size + 4] = 900;
    const { elev, repaired } = repair(e, size);
    expect(repaired).toBe(1);
    expect(elev[3 * size + 4]).toBeCloseTo(0, 3);
  });

  it('repairs a cluster of adjacent bad posts', () => {
    const size = 8;
    for (const run of [2, 3]) {
      const e = grid(size, -38.5);
      for (let k = 0; k < run; k++) e[4 * size + 2 + k] = -892;
      const { elev, repaired } = repair(e, size);
      expect(repaired).toBe(run);
      for (let k = 0; k < run; k++) expect(elev[4 * size + 2 + k]).toBeCloseTo(-38.5, 3);
    }
  });

  it('repairs a bad post in an edge column and in a corner', () => {
    const size = 8;
    for (const i of [5 * size, 7 * size - 1, 0, size * size - 1]) {
      const e = grid(size);
      e[i] = 942;
      const { elev, repaired } = repair(e, size);
      expect(repaired).toBe(1);
      expect(elev[i]).toBeCloseTo(23.5, 3);
    }
  });

  it('leaves a coastal cliff of flat water against land untouched', () => {
    const size = 16;
    const e = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) e[y * size + x] = x < 8 ? 0 : 10;
    expect(findOutlierPosts(e, size).some((f) => f === 1)).toBe(false);
  });

  it('leaves a steep ramp untouched even where a post deviates by more than the floor', () => {
    const size = 32;
    const e = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) e[y * size + x] = 60 * x;
    e[16 * size + 16] += 150;
    expect(findOutlierPosts(e, size).some((f) => f === 1)).toBe(false);
  });

  it('repairs out-of-envelope posts before the medians are taken', () => {
    const size = 8;
    const e = grid(size);
    e[2 * size + 3] = -32768;
    const { elev, repaired } = repair(e, size);
    expect(repaired).toBe(1);
    expect(Array.from(elev).every((v) => Math.abs(v - 23.5) < 1e-3)).toBe(true);
  });

  it('fills an out-of-envelope post from its nearest valid neighbour, not from the median', () => {
    const size = 8;
    const e = grid(size, 0);
    e[2 * size + 4] = 40;
    e[3 * size + 4] = -32768;
    const { elev, repaired } = repair(e, size);
    expect(repaired).toBe(1);
    expect(elev[3 * size + 4]).toBeCloseTo(40, 3);
  });
});

// A plane, so the bilinear resample is exact and only the coordinate mapping is under test.
const plane = (x: number, y: number) => 100 + x + 10 * y;

describe('overzoomTile', () => {
  const size = 16;
  const elev = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) elev[y * size + x] = plane(x, y);
  const parent: DemTile = { z: 14, x: 8567, y: 5837, size, elev };

  it('names the ancestor that covers a tile', () => {
    expect(ancestorTile({ z: 17, x: 68536, y: 46698 }, 14)).toEqual({ z: 14, x: 8567, y: 5837 });
    expect(ancestorTile({ z: 17, x: 68536, y: 46698 }, 17)).toEqual({ z: 17, x: 68536, y: 46698 });
  });

  it('resamples the child sub-rect of its ancestor', () => {
    const child = { z: 17, x: 8567 * 8 + 5, y: 5837 * 8 + 2 };
    const t = overzoomTile(parent, child);
    expect(t).toMatchObject({ ...child, size });
    // The sub-rect is span = size / 8 parent posts wide, at parent pixel (5 * span, 2 * span).
    const span = size / 8;
    for (const [px, py] of [
      [0, 0],
      [7, 3],
      [size - 1, size - 1]
    ])
      expect(t.elev[py * size + px]).toBeCloseTo(plane(5 * span + (px + 0.5) / 8 - 0.5, 2 * span + (py + 0.5) / 8 - 0.5), 4);
  });

  it('splits the parent between its four children', () => {
    const kids = [0, 1, 2, 3].map((i) => overzoomTile(parent, { z: 15, x: parent.x * 2 + (i & 1), y: parent.y * 2 + (i >> 1) }));
    // The four together span the parent's whole post range; the outermost samples clamp to its edge posts.
    const all = kids.flatMap((k) => [...k.elev]);
    expect(Math.min(...all)).toBeCloseTo(plane(0, 0), 4);
    expect(Math.max(...all)).toBeCloseTo(plane(size - 1, size - 1), 4);
    // The right-hand child starts where the left-hand one left off, half a parent post further on.
    expect(kids[1].elev[0] - kids[0].elev[size - 1]).toBeCloseTo(0.5, 4);
  });
});

/** An LRU like the worker's DemCache whose loads land only when the test says so. */
class SlowDem implements RetainingDemSource {
  private tiles = new Map<string, DemTile>();
  private pending = new Map<string, () => void>();
  private holds = new Holds();
  constructor(private maxTiles: number) {}
  get(z: number, x: number, y: number) {
    return this.tiles.get(tileKey(z, x, y));
  }
  retain(coords: readonly TileCoord[]) {
    return this.holds.retain(coords.map((c) => tileKey(c.z, c.x, c.y)));
  }
  loadAll(coords: TileCoord[]) {
    return Promise.all(coords.map((c) => (this.tiles.has(tileKey(c.z, c.x, c.y)) ? undefined : new Promise<void>((r) => this.pending.set(tileKey(c.z, c.x, c.y), r))))).then(() => {});
  }
  /** One tile arrives, evicting the oldest unheld ones past the cap. */
  arrive(c: TileCoord, elevM: number) {
    const k = tileKey(c.z, c.x, c.y);
    this.tiles.set(k, { ...c, size: 4, elev: new Float32Array(16).fill(elevM) });
    for (const e of evictionKeys(this.tiles.keys(), this.holds, this.tiles.size - this.maxTiles)) this.tiles.delete(e);
    this.pending.get(k)?.();
  }
}

describe('lowestGroundAt', () => {
  const z = 3;
  const at = (x: number, y: number) => tilePixelToLngLat(z, x, y, 2, 2, 4);

  it('keeps its tile through another request filling the cache before it reads', async () => {
    const src = new SlowDem(2);
    const ground = lowestGroundAt(src, [at(2, 2)], z, 4);
    void src.loadAll([{ z, x: 5, y: 5 }, { z, x: 6, y: 6 }]);
    src.arrive({ z, x: 2, y: 2 }, 21);
    src.arrive({ z, x: 5, y: 5 }, 0);
    src.arrive({ z, x: 6, y: 6 }, 0);
    expect(await ground).toBe(21);
  });

  it('takes the lowest point and skips points without data', async () => {
    const src = new SlowDem(8);
    const ground = lowestGroundAt(src, [at(2, 2), at(3, 2), at(7, 7)], z, 4);
    src.arrive({ z, x: 2, y: 2 }, 30);
    src.arrive({ z, x: 3, y: 2 }, 12);
    src.arrive({ z, x: 7, y: 7 }, NaN);
    expect(await ground).toBe(12);
  });

  it('is null when no point has data', async () => {
    const src = new SlowDem(8);
    const ground = lowestGroundAt(src, [at(2, 2)], z, 4);
    src.arrive({ z, x: 2, y: 2 }, NaN);
    expect(await ground).toBeNull();
  });
});
