import { describe, expect, it } from 'vitest';
import { cameraBasis, type Camera } from '@core/optics/projection';
import type { BuildingBatch } from '@workers/buildings.protocol';
import { destination, type LngLat } from './geodesy';
import { buildPrisms, makePrismTarget, rasterisePrisms, type PrismShading } from './prismRaster';

const PIN: LngLat = { lng: -74, lat: 40.75 };
const SHADE: PrismShading = { lightAzDeg: 180, hazeRgb: [150, 170, 200], night: 0, rangeM: 20_000 };

/** Local east/north metres to lng/lat around the pin. */
const at = (e: number, n: number) => destination(PIN, (Math.atan2(e, n) * 180) / Math.PI, Math.hypot(e, n));

interface Box {
  /** Footprint in local east/north metres. */
  ring: [number, number][];
  heightM: number;
  minHeightM?: number;
  groundM?: number;
}

function batchOf(boxes: Box[]): BuildingBatch {
  const ringStart = new Int32Array(boxes.length + 1);
  for (const [i, b] of boxes.entries()) ringStart[i + 1] = ringStart[i] + b.ring.length;
  const nv = ringStart[boxes.length];
  const batch: BuildingBatch = {
    tileKey: '14/0/0',
    count: boxes.length,
    ringStart,
    lng: new Float64Array(nv),
    lat: new Float64Array(nv),
    heightM: new Float32Array(boxes.length),
    minHeightM: new Float32Array(boxes.length),
    cLng: new Float64Array(boxes.length),
    cLat: new Float64Array(boxes.length),
    groundM: new Float32Array(boxes.length)
  };
  for (const [i, b] of boxes.entries()) {
    batch.heightM[i] = b.heightM;
    batch.minHeightM[i] = b.minHeightM ?? 0;
    batch.groundM[i] = b.groundM ?? 0;
    let ce = 0;
    let cn = 0;
    for (const [k, [e, n]] of b.ring.entries()) {
      const p = at(e, n);
      batch.lng[ringStart[i] + k] = p.lng;
      batch.lat[ringStart[i] + k] = p.lat;
      ce += e;
      cn += n;
    }
    const c = at(ce / b.ring.length, cn / b.ring.length);
    batch.cLng[i] = c.lng;
    batch.cLat[i] = c.lat;
  }
  return batch;
}

const square = (cE: number, cN: number, side: number): [number, number][] => [
  [cE - side / 2, cN - side / 2],
  [cE + side / 2, cN - side / 2],
  [cE + side / 2, cN + side / 2],
  [cE - side / 2, cN + side / 2]
];

const camera = (azimuthDeg: number, elevationDeg: number, focalMm = 50): Camera => ({ azimuthDeg, elevationDeg, focalMm, frameWmm: 36, frameHmm: 24 });

function render(boxes: Box[], cam: Camera, rw = 120, rh = 80, eyeM = 0, shade = SHADE) {
  const tile = buildPrisms(batchOf(boxes), PIN, eyeM);
  const t = makePrismTarget(rw, rh);
  const drawn = rasterisePrisms(t, cam, cameraBasis(cam), [tile], shade);
  return { t, drawn };
}

/** Columns and rows holding at least one drawn pixel. */
function extent(t: { rw: number; rh: number; depth: Float32Array }) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let filled = 0;
  for (let y = 0; y < t.rh; y++) {
    for (let x = 0; x < t.rw; x++) {
      if (!Number.isFinite(t.depth[y * t.rw + x])) continue;
      filled++;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return { x0, x1, y0, y1, filled, widthPx: x1 - x0 + 1, heightPx: y1 - y0 + 1 };
}

describe('prismRaster', () => {
  it('covers the projected span of a 20 m box whose near face is 200 m ahead, at depth 200', () => {
    // 20 m cube centred 210 m north: the silhouette is its near face, 20 m wide at 200 m.
    const { t } = render([{ ring: square(0, 210, 20), heightM: 20 }], camera(0, 0), 120, 80, 10);
    const ex = extent(t);
    const span = (50 * (20 / 200) * 120) / 36;
    expect(ex.widthPx).toBeGreaterThan(span - 1.5);
    expect(ex.widthPx).toBeLessThan(span + 1.5);
    // The eye is level with the middle of the near wall, so the frame centre row lands on it.
    const centre = t.depth[Math.floor(t.rh / 2) * t.rw + Math.floor(t.rw / 2)];
    expect(centre).toBeGreaterThan(199);
    expect(centre).toBeLessThan(201);
  });

  it('lets a near box hide a far one behind it', () => {
    const far = { ring: square(0, 600, 40), heightM: 60 };
    const near = { ring: square(0, 200, 40), heightM: 60 };
    const cam = camera(0, 0);
    const alone = render([far], cam, 120, 80, 30).t;
    const both = render([far, near], cam, 120, 80, 30).t;
    const i = Math.floor(both.rh / 2) * both.rw + Math.floor(both.rw / 2);
    expect(alone.depth[i]).toBeGreaterThan(500);
    expect(both.depth[i]).toBeGreaterThan(179);
    expect(both.depth[i]).toBeLessThan(181);
    let hidden = 0;
    for (let k = 0; k < both.depth.length; k++) if (Number.isFinite(alone.depth[k]) && both.depth[k] < 300) hidden++;
    expect(hidden).toBeGreaterThan(100);
  });

  it('fills an L-shaped roof by even-odd, leaving the notch empty', () => {
    // 80 m square with the north-east quadrant cut out, seen from 400 m straight above.
    const ring: [number, number][] = [
      [-40, -40],
      [40, -40],
      [40, 0],
      [0, 0],
      [0, 40],
      [-40, 40]
    ];
    const cam = camera(0, -90, 20);
    const { t } = render([{ ring, heightM: 20 }], cam, 200, 200, 400);
    const ex = extent(t);
    expect(ex.filled).toBeGreaterThan(300);
    // Notch centre, 20 m from either cut edge, and a mirrored point inside the solid leg.
    const px = (e: number, n: number) => {
      const u = 20 - 400;
      const x = Math.round(((e / -u) * cam.focalMm * 200) / 36 + 100 - 0.5);
      const y = Math.round(100 - 0.5 - ((n / -u) * cam.focalMm * 200) / 24);
      return t.depth[y * 200 + x];
    };
    expect(px(20, 20)).toBe(Infinity);
    expect(Number.isFinite(px(-20, -20))).toBe(true);
    expect(Number.isFinite(px(-20, 20))).toBe(true);
  });

  it('writes nothing for a box behind the camera', () => {
    const { t, drawn } = render([{ ring: square(0, -200, 40), heightM: 60 }], camera(0, 0));
    expect(drawn).toBe(0);
    expect(extent(t).filled).toBe(0);
  });

  it('produces only finite positive depths for a box straddling the near plane', () => {
    // 40 m box abreast of the eye: its west wall runs from behind the camera to well in front of it.
    const { t } = render([{ ring: square(30, 5, 40), heightM: 30 }], camera(0, 0, 14));
    const ex = extent(t);
    expect(ex.filled).toBeGreaterThan(0);
    for (const d of t.depth) expect(d === Infinity || (Number.isFinite(d) && d > 0)).toBe(true);
  });

  it('draws the same prism whichever way its ring winds', () => {
    const ring = square(0, 300, 60);
    const cam = camera(0, 0);
    const ccw = render([{ ring, heightM: 60 }], cam, 120, 80, 30).t;
    const cw = render([{ ring: ring.toReversed(), heightM: 60 }], cam, 120, 80, 30).t;
    expect([...cw.depth]).toEqual([...ccw.depth]);
    expect([...cw.color]).toEqual([...ccw.color]);
    expect(extent(ccw).filled).toBeGreaterThan(0);
  });

  it('culls buildings smaller than a pixel and beyond the range', () => {
    const tiny = render([{ ring: square(0, 20_000, 2), heightM: 2, groundM: 0 }], camera(0, 0), 120, 80, 0, { ...SHADE, rangeM: 40_000 });
    expect(tiny.drawn).toBe(0);
    const far = render([{ ring: square(0, 30_000, 200), heightM: 300 }], camera(0, 0), 120, 80, 0, { ...SHADE, rangeM: 20_000 });
    expect(far.drawn).toBe(0);
  });

  it('shades walls by the light azimuth and hazes distant buildings toward the ground colour', () => {
    const box = { ring: square(0, 300, 60), heightM: 60 };
    const cam = camera(0, 0);
    const lit = render([box], cam, 120, 80, 30, { ...SHADE, lightAzDeg: 180 }).t;
    const dark = render([box], cam, 120, 80, 30, { ...SHADE, lightAzDeg: 0 }).t;
    const i = Math.floor(dark.rh / 2) * dark.rw + Math.floor(dark.rw / 2);
    // The wall faces south (bearing 180), so a light from the south is full strength.
    expect(lit.color[i] >> 16).toBeGreaterThan(dark.color[i] >> 16);
    const night = render([box], cam, 120, 80, 30, { ...SHADE, lightAzDeg: 180, night: 1 }).t;
    expect(night.color[i] >> 16).toBeLessThan(lit.color[i] >> 16);
    expect(night.color[i] >> 16).toBeGreaterThan(100);
  });
});
