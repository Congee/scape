import { describe, expect, it } from 'vitest';
import { dirtyRects, maskStrips, type MaskRect } from './shadowMask';
import { blitGrid, raiseGrid, stampFootprint, stampTriangles, sunCeiling, type HeightGrid } from './sunCeiling';

const R2D = 180 / Math.PI;

function makeGrid(nx: number, ny: number, fill = 0, cellM = 1): HeightGrid {
  const h = new Float32Array(nx * ny);
  h.fill(fill);
  return { cellM, nx, ny, originE: 0, originN: 0, h };
}

const at = (g: HeightGrid, c: Float32Array, ix: number, iy: number) => c[iy * g.nx + ix];

describe('sunCeiling', () => {
  it('leaves a flat grid lit at its own surface', () => {
    const g = makeGrid(9, 7, 12);
    for (const az of [0, 37, 180, 300]) {
      const c = sunCeiling(g, az, 25);
      for (let i = 0; i < c.length; i++) expect(c[i]).toBe(12);
    }
  });

  it('decays a column shadow at tan(alt) and grounds it at h / tan(alt)', () => {
    const g = makeGrid(41, 41);
    g.h[20 * 41 + 20] = 10;
    // Sun due north, so the shadow runs south.
    const c = sunCeiling(g, 0, 45);
    expect(at(g, c, 20, 20)).toBe(10);
    for (let k = 1; k <= 9; k++) expect(at(g, c, 20, 20 - k)).toBeCloseTo(10 - k, 4);
    expect(at(g, c, 20, 10)).toBeCloseTo(0, 5);
    expect(at(g, c, 20, 9)).toBe(0);
    // Nothing upwind of the column is touched.
    for (let k = 1; k <= 9; k++) expect(at(g, c, 20, 20 + k)).toBe(0);
  });

  it('scales the fall with the true ground step of a diagonal march', () => {
    const g = makeGrid(41, 41);
    g.h[20 * 41 + 20] = 40;
    // Sun in the north-east, so the shadow runs south-west a cell at a time.
    const c = sunCeiling(g, 45, 45);
    for (let k = 1; k <= 8; k++) expect(at(g, c, 20 - k, 20 - k)).toBeCloseTo(40 - k * Math.SQRT2, 3);
  });

  it('throws the shadow away from the sun', () => {
    const g = makeGrid(21, 21);
    g.h[10 * 21 + 10] = 30;
    const cases: [number, number, number][] = [
      [0, 0, -1],
      [90, -1, 0],
      [180, 0, 1],
      [270, 1, 0],
      [45, -1, -1]
    ];
    for (const [az, de, dn] of cases) {
      const c = sunCeiling(g, az, 45);
      expect(at(g, c, 10 + de * 3, 10 + dn * 3)).toBeGreaterThan(0);
      expect(at(g, c, 10 - de * 3, 10 - dn * 3)).toBe(0);
    }
  });

  it('shadows everything at or below the horizon', () => {
    const g = makeGrid(5, 5, 3);
    for (const alt of [0, -0.5, -20]) {
      const c = sunCeiling(g, 120, alt);
      for (let i = 0; i < c.length; i++) expect(c[i]).toBe(-Infinity);
    }
  });

  it('casts nothing past the column under a vertical sun', () => {
    const g = makeGrid(9, 9);
    g.h[4 * 9 + 4] = 25;
    const c = sunCeiling(g, 180, 90);
    expect(at(g, c, 4, 4)).toBe(25);
    for (let k = 1; k <= 4; k++) expect(at(g, c, 4, 4 + k)).toBe(0);
  });

  it('keeps unknown cells unshadowed and casting nothing', () => {
    const g = makeGrid(9, 9);
    g.h[6 * 9 + 4] = Number.NaN;
    const c = sunCeiling(g, 180, 45);
    expect(at(g, c, 4, 6)).toBe(-Infinity);
    // The blend downwind falls back on the known neighbour instead of inheriting the gap.
    for (let iy = 7; iy < 9; iy++) expect(at(g, c, 4, iy)).toBe(0);
  });
});

describe('stampFootprint', () => {
  it('raises exactly the cells a rectangle covers', () => {
    const g = makeGrid(7, 7);
    stampFootprint(g, [1.5, 4.5, 4.5, 1.5], [2.5, 2.5, 5.5, 5.5], 18);
    for (let iy = 0; iy < 7; iy++) {
      for (let ix = 0; ix < 7; ix++) {
        const inside = ix >= 2 && ix <= 4 && iy >= 3 && iy <= 5;
        expect(g.h[iy * 7 + ix]).toBe(inside ? 18 : 0);
      }
    }
  });

  it('takes the max rather than overwriting', () => {
    const g = makeGrid(5, 5);
    g.h[2 * 5 + 2] = 30;
    stampFootprint(g, [0.5, 3.5, 3.5, 0.5], [0.5, 0.5, 3.5, 3.5], 10);
    expect(g.h[2 * 5 + 2]).toBe(30);
    expect(g.h[1 * 5 + 1]).toBe(10);
  });

  it('is a no-op for a degenerate ring', () => {
    const g = makeGrid(4, 4);
    stampFootprint(g, [1, 2], [1, 2], 5);
    expect(Array.from(g.h).every((v) => v === 0)).toBe(true);
  });
});

describe('buildings and terrain together', () => {
  it('shadows a building standing below a hill upwind', () => {
    const g = makeGrid(9, 41);
    g.h[30 * 9 + 4] = 30;
    stampFootprint(g, [3.5, 4.5, 4.5, 3.5], [34.5, 34.5, 35.5, 35.5], 20);
    // Sun due south: the shadow runs north, over the building five cells past the hill.
    const c = sunCeiling(g, 180, 45);
    expect(at(g, c, 4, 35)).toBeCloseTo(25, 3);
    expect(at(g, c, 4, 35)).toBeGreaterThan(20);
  });

  it('leaves a building taller than the hill shadow lit', () => {
    const g = makeGrid(9, 41);
    g.h[30 * 9 + 4] = 30;
    stampFootprint(g, [3.5, 4.5, 4.5, 3.5], [34.5, 34.5, 35.5, 35.5], 28);
    const c = sunCeiling(g, 180, 45);
    expect(at(g, c, 4, 35)).toBe(28);
  });

  it('grounds the hill shadow where the geometry says', () => {
    const g = makeGrid(9, 41);
    g.h[30 * 9 + 4] = 30;
    // tan(alt) = 0.5, so a 30 m hill reaches the ground 60 cells out: still shadowed at the edge.
    const c = sunCeiling(g, 180, Math.atan(0.5) * R2D);
    expect(at(g, c, 4, 40)).toBeCloseTo(25, 3);
  });
});

describe('stampTriangles', () => {
  it('stamps a sloped triangle at its interpolated height', () => {
    const g = makeGrid(6, 6);
    // A plane rising 2 m per metre east, over the lower-left half of the grid.
    stampTriangles(g, [0, 5, 0], [0, 0, 5], [10, 20, 10]);
    expect(g.h[0]).toBe(10);
    expect(g.h[2 * 6 + 2]).toBeCloseTo(14, 5);
    expect(g.h[5]).toBe(20);
    expect(g.h[5 * 6 + 5]).toBe(0);
  });

  it('takes the max and stamps a vertex thinner than a cell', () => {
    const g = makeGrid(5, 5);
    g.h[12] = 50;
    stampTriangles(g, [0.5, 3.5, 0.5, 3.1, 3.2, 3.1], [0.5, 0.5, 3.5, 1.1, 1.1, 1.2], [30, 30, 30, 90, 90, 95]);
    expect(g.h[12]).toBe(50);
    expect(g.h[6]).toBe(30);
    expect(g.h[1 * 5 + 3]).toBe(95);
  });

  it('leaves the grid alone outside it and for walls', () => {
    const g = makeGrid(3, 3);
    stampTriangles(g, [-10, -5, -10, 1, 1, 1], [-10, -10, -5, 0, 2, 2], [9, 9, 9, 0, 0, 40]);
    expect(Array.from(g.h).filter((v) => v !== 0)).toEqual([40]);
  });
});

describe('blitGrid and raiseGrid', () => {
  const src = { cellM: 2, nx: 2, ny: 2, originE: 2, originN: 0, h: Float32Array.from([1, 2, Number.NaN, 4]) };

  it('copies the shared cells and leaves the rest', () => {
    const dst = makeGrid(3, 3, 9, 2);
    blitGrid(src, dst);
    expect([...dst.h]).toEqual([9, 1, 2, 9, Number.NaN, 4, 9, 9, 9]);
  });

  it('raises only where the source stands higher and is known', () => {
    const dst = makeGrid(3, 3, 3, 2);
    raiseGrid(src, dst);
    expect([...dst.h]).toEqual([3, 3, 3, 3, 3, 4, 3, 3, 3]);
  });
});

const ground = (e: number, n: number) => Math.fround(Math.sin(e * 0.013) * 30 + Math.cos(n * 0.007) * 20);

describe('stamping strips', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  // Footprints and triangles over the whole area, many straddling the strip edges.
  const rings = Array.from({ length: 120 }, () => {
    const e = -400 + rand() * 800;
    const n = -300 + rand() * 600;
    const w = 3 + rand() * 60;
    return { e: [e, e + w, e + w * 0.7, e - w * 0.2], n: [n, n + w * 0.3, n + w, n + w * 0.8], u: 20 + rand() * 60 };
  });
  const tris = Array.from({ length: 80 }, () => {
    const e = -400 + rand() * 800;
    const n = -300 + rand() * 600;
    return { e: [e, e + rand() * 50, e - rand() * 30], n: [n, n + rand() * 10, n + rand() * 45], u: [30 + rand() * 20, 40, 25 + rand() * 30] };
  });

  function stampAll(g: HeightGrid): void {
    for (const r of rings) stampFootprint(g, r.e, r.n, r.u);
    for (const t of tris) stampTriangles(g, t.e, t.n, t.u);
  }

  function terrain(r: MaskRect): HeightGrid {
    const g = { ...r, h: new Float32Array(r.nx * r.ny) };
    for (let iy = 0; iy < r.ny; iy++) for (let ix = 0; ix < r.nx; ix++) g.h[iy * r.nx + ix] = ground(r.originE + ix * r.cellM, r.originN + iy * r.cellM);
    return g;
  }

  function whole(r: MaskRect): HeightGrid {
    const g = terrain(r);
    stampAll(g);
    return g;
  }

  /** `next` from `last`'s cells and freshly stamped strips, as the mask worker grows it. */
  function grown(last: MaskRect, next: MaskRect): HeightGrid {
    const parts = (maskStrips(last, next) ?? []).map(terrain);
    const g = { ...next, h: new Float32Array(next.nx * next.ny) };
    blitGrid(whole(last), g);
    for (const p of parts) {
      stampAll(p);
      blitGrid(p, g);
    }
    return g;
  }

  const last = { originE: -128, originN: -128, nx: 64, ny: 48, cellM: 2 };

  it.each([
    ['west', { ...last, originE: -256, nx: 128 }],
    ['east', { ...last, nx: 112 }],
    ['south', { ...last, originN: -256, ny: 112 }],
    ['north', { ...last, ny: 96 }],
    ['north-east corner', { ...last, nx: 96, ny: 96 }],
    ['south-west corner', { ...last, originE: -256, originN: -192, nx: 128, ny: 80 }],
    ['every side', { ...last, originE: -288, originN: -256, nx: 256, ny: 192 }],
    ['a shift that drops cells', { ...last, originE: -64, originN: -96 }]
  ])('matches a whole stamp bit for bit when grown %s', (_, next) => {
    expect(grown(last, next).h).toEqual(whole(next).h);
  });

  it('matches with the new occluders stamped over the whole grid and the strips raised in', () => {
    const next = { ...last, originE: -256, originN: -192, nx: 160, ny: 112 };
    const g = { ...next, h: new Float32Array(next.nx * next.ny) };
    const parts = (maskStrips(last, next) ?? []).map(terrain);
    const early = terrain(last);
    for (const r of rings.slice(0, 60)) stampFootprint(early, r.e, r.n, r.u);
    blitGrid(early, g);
    for (const p of parts) blitGrid(p, g);
    for (const r of rings.slice(60)) stampFootprint(g, r.e, r.n, r.u);
    for (const t of tris) stampTriangles(g, t.e, t.n, t.u);
    for (const p of parts) {
      for (const r of rings.slice(0, 60)) stampFootprint(p, r.e, r.n, r.u);
      raiseGrid(p, g);
    }
    expect(g.h).toEqual(whole(next).h);
  });

  it('matches once the cells a dropped occluder raised are rebuilt and the new occluders go over them', () => {
    const next = { ...last, originE: -256, nx: 128 };
    const gone = rings.slice(0, 20).map((r) => ({ e: r.e.map((e) => e + 7), n: r.n, u: r.u + 30 }));
    const old = (p: HeightGrid) => {
      for (const r of rings.slice(0, 60)) stampFootprint(p, r.e, r.n, r.u);
      for (const t of tris) stampTriangles(p, t.e, t.n, t.u);
    };
    const early = terrain(last);
    old(early);
    for (const r of gone) stampFootprint(early, r.e, r.n, r.u);
    const g = { ...next, h: new Float32Array(next.nx * next.ny) };
    blitGrid(early, g);
    const boxes = gone.map((r) => ({ e0: Math.min(...r.e), n0: Math.min(...r.n), e1: Math.max(...r.e), n1: Math.max(...r.n) }));
    const dirty = dirtyRects(last, next, boxes).map(terrain);
    expect(dirty.length).toBeGreaterThan(0);
    for (const p of [...(maskStrips(last, next) ?? []).map(terrain), ...dirty]) {
      old(p);
      blitGrid(p, g);
    }
    for (const r of rings.slice(60)) stampFootprint(g, r.e, r.n, r.u);
    expect(g.h).toEqual(whole(next).h);
  });
});
