import { describe, expect, it } from 'vitest';
import { frameOf, frameToLngLat, MASK_BIAS_M, MASK_MAX_PX, MASK_MIN_CELL_M, maskCorners, maskFrame, maskPixels, maskRect, shadowMask, SHADOW_RGB } from './shadowMask';

const merc = (lat: number) => 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI);

describe('shadowMask', () => {
  it('reads a lit cell as transparent', () => {
    const h = Float32Array.from([10, 10]);
    expect([...shadowMask(h, Float32Array.from([10, 10]), 5)]).toEqual([0, 0]);
  });

  it('ramps from lit to full over softM below the ceiling', () => {
    const h = new Float32Array(4);
    const ceiling = Float32Array.from([MASK_BIAS_M, MASK_BIAS_M + 2, MASK_BIAS_M + 4, MASK_BIAS_M + 40]);
    expect([...shadowMask(h, ceiling, 4)]).toEqual([0, 128, 255, 255]);
  });

  it('holds the lit surface clear of its own ceiling by the bias', () => {
    const h = Float32Array.from([0]);
    expect(shadowMask(h, Float32Array.from([MASK_BIAS_M * 0.9]), 5)[0]).toBe(0);
  });

  it('leaves an unknown height and a night ceiling lit', () => {
    const h = Float32Array.from([NaN, 0]);
    expect([...shadowMask(h, Float32Array.from([100, -Infinity]), 5)]).toEqual([0, 0]);
  });
});

describe('maskPixels', () => {
  it('flips the southernmost grid row to the bottom image row', () => {
    const mask = Uint8Array.from([1, 2, 3, 4, 5, 6]); // row 0 (south) = 1,2,3
    const px = maskPixels(mask, 3, 2);
    const alpha = [...px].filter((_, i) => i % 4 === 3);
    expect(alpha).toEqual([4, 5, 6, 1, 2, 3]);
  });

  it('paints the shadow colour everywhere, opacity carried by alpha alone', () => {
    const px = maskPixels(Uint8Array.from([0, 255]), 2, 1);
    expect(Array.from(px.slice(0, 3))).toEqual([...SHADOW_RGB]);
    expect(Array.from(px.slice(4, 7))).toEqual([...SHADOW_RGB]);
  });
});

describe('maskRect', () => {
  it('covers the requested extent', () => {
    const r = maskRect(-300, 700, -1200, 400);
    expect(r.originE).toBeLessThanOrEqual(-300);
    expect(r.originN).toBeLessThanOrEqual(-1200);
    expect(r.originE + (r.nx - 1) * r.cellM).toBeGreaterThanOrEqual(700);
    expect(r.originN + (r.ny - 1) * r.cellM).toBeGreaterThanOrEqual(400);
  });

  it('never exceeds the cell budget, however large the rect', () => {
    for (const half of [500, 5_000, 50_000, 500_000]) {
      const r = maskRect(-half, half, -half, half);
      expect(r.nx).toBeLessThanOrEqual(MASK_MAX_PX);
      expect(r.ny).toBeLessThanOrEqual(MASK_MAX_PX);
    }
  });

  it('holds the cell floor on a small rect', () => {
    expect(maskRect(-100, 100, -100, 100).cellM).toBe(MASK_MIN_CELL_M);
  });

  it('takes the same grid for a rect nudged less than the snap', () => {
    const a = maskRect(-2000, 2000, -2000, 2000);
    const b = maskRect(-1999, 2001, -1998, 2002);
    expect(b).toEqual(a);
  });

  it('coarsens by powers of two, so a zoom nudge keeps the grid', () => {
    const a = maskRect(-3000, 3000, -3000, 3000);
    const b = maskRect(-3100, 3100, -3100, 3100);
    expect(b.cellM).toBe(a.cellM);
    expect(Math.log2(a.cellM / MASK_MIN_CELL_M) % 1).toBe(0);
  });
});

describe('maskFrame', () => {
  it('round-trips a point through the local frame', () => {
    const centre = { lng: -74.01, lat: 40.71 };
    const f = maskFrame(centre);
    const p = { lng: -73.98, lat: 40.74 };
    const { e, n } = frameOf(f, p);
    const back = frameToLngLat(f, e, n);
    expect(back.lng).toBeCloseTo(p.lng, 9);
    expect(back.lat).toBeCloseTo(p.lat, 9);
  });

  it('puts the centre at the origin', () => {
    const centre = { lng: 8.53, lat: 46.02 };
    const { e, n } = frameOf(maskFrame(centre), centre);
    expect(e).toBeCloseTo(0, 6);
    expect(n).toBeCloseTo(0, 6);
  });

  it('keeps cells square to within the secant ratio across a tall rect', () => {
    const f = maskFrame({ lng: 0, lat: 60 });
    // 30 km tall at lat 60: the north edge's ground cell against the centre's.
    const north = frameToLngLat(f, 0, 15_000);
    expect(Math.cos(north.lat * (Math.PI / 180)) / Math.cos(60 * (Math.PI / 180))).toBeCloseTo(1, 2);
  });
});

describe('maskCorners', () => {
  it('bounds the cell centres by half a cell', () => {
    const centre = { lng: 0, lat: 0 };
    const r = { originE: -100, originN: -100, nx: 11, ny: 11, cellM: 20 };
    const [nw, ne, se, sw] = maskCorners(centre, r);
    expect(nw[1]).toBeGreaterThan(0);
    expect(sw[1]).toBeLessThan(0);
    expect(nw[0]).toBeLessThan(0);
    expect(ne[0]).toBeGreaterThan(0);
    expect(ne[1]).toBeCloseTo(nw[1], 12);
    expect(se[1]).toBeCloseTo(sw[1], 12);
    // Half a cell past the outermost centre, north and south alike.
    const f = maskFrame(centre);
    expect(frameOf(f, { lng: nw[0], lat: nw[1] }).n).toBeCloseTo(110, 6);
    expect(frameOf(f, { lng: sw[0], lat: sw[1] }).n).toBeCloseTo(-110, 6);
  });
});

describe('image registration', () => {
  it('lands every row where an image source linear in Mercator puts it', () => {
    // The worst case the sizing rule allows: a 30 km tall rect at lat 60.
    const centre = { lng: 0, lat: 60 };
    const f = maskFrame(centre);
    const r = maskRect(-15_000, 15_000, -15_000, 15_000);
    const [nw, , , sw] = maskCorners(centre, r);
    const yN = merc(nw[1]);
    const yS = merc(sw[1]);
    let worstM = 0;
    for (let iy = 0; iy < r.ny; iy++) {
      const n = r.originN + iy * r.cellM;
      const trueLat = frameToLngLat(f, 0, n).lat;
      // Pixel centres sit at (iy + 0.5) / ny up from the image's south edge.
      const placed = yS + (yN - yS) * ((iy + 0.5) / r.ny);
      worstM = Math.max(worstM, Math.abs(placed - merc(trueLat)) * 40_075_016.686 * Math.cos((trueLat * Math.PI) / 180));
    }
    expect(worstM).toBeLessThan(r.cellM / 2);
    expect(worstM).toBeLessThan(0.01);
  });
});
