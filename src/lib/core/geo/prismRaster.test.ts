import { describe, expect, it } from 'vitest';
import { cameraBasis, type Camera } from '@core/optics/projection';
import { RoofShape, type BuildingBatch } from '@workers/buildings.protocol';
import { destination, type LngLat } from './geodesy';
import { buildPrisms, makePrismTarget, rasterisePrisms, type PrismShading } from './prismRaster';

const PIN: LngLat = { lng: -74, lat: 40.75 };
const SHADE: PrismShading = { lightAzDeg: 180, hazeRgb: [150, 170, 200], night: 0, rangeM: 20_000 };
const R2D = 180 / Math.PI;

/** Local east/north metres to lng/lat around the pin. */
const at = (e: number, n: number) => destination(PIN, (Math.atan2(e, n) * 180) / Math.PI, Math.hypot(e, n));

interface Box {
  /** Footprint in local east/north metres. */
  ring: [number, number][];
  heightM: number;
  minHeightM?: number;
  groundM?: number;
  roofShape?: RoofShape;
  roofHeightM?: number;
  roofDirDeg?: number;
  roofAcross?: number;
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
    roofShape: new Uint8Array(boxes.length),
    roofHeightM: new Float32Array(boxes.length),
    roofDirDeg: new Float32Array(boxes.length).fill(NaN),
    roofAcross: new Uint8Array(boxes.length),
    cLng: new Float64Array(boxes.length),
    cLat: new Float64Array(boxes.length),
    groundM: new Float32Array(boxes.length)
  };
  for (const [i, b] of boxes.entries()) {
    batch.heightM[i] = b.heightM;
    batch.minHeightM[i] = b.minHeightM ?? 0;
    batch.groundM[i] = b.groundM ?? 0;
    batch.roofShape[i] = b.roofShape ?? RoofShape.Flat;
    batch.roofHeightM[i] = b.roofHeightM ?? 0;
    batch.roofDirDeg[i] = b.roofDirDeg ?? NaN;
    batch.roofAcross[i] = b.roofAcross ?? 0;
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

const rect = (cE: number, cN: number, we: number, dn: number): [number, number][] => [
  [cE - we / 2, cN - dn / 2],
  [cE + we / 2, cN - dn / 2],
  [cE + we / 2, cN + dn / 2],
  [cE - we / 2, cN + dn / 2]
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

// -- Skyline probes, for a camera looking due north --------------------------------------------

const ROOF_W = 480;
const ROOF_H = 480;

/** Raster column a point at `e` metres east and `n` metres north falls in, at elevation 0. */
const colOf = (e: number, n: number, cam: Camera) => Math.round(((e / n) * cam.focalMm * ROOF_W) / cam.frameWmm + ROOF_W / 2 - 0.5);

/** Elevation angle of a pixel row's centre; the camera turns about the east axis, so this is exact. */
const rowAngleDeg = (cam: Camera, py: number) => cam.elevationDeg + Math.atan((((ROOF_H / 2 - 0.5 - py) * cam.frameHmm) / ROOF_H) / cam.focalMm) * R2D;

function edgeRow(t: { rw: number; rh: number; depth: Float32Array }, x: number, from: 'top' | 'bottom'): number {
  const ys = from === 'top' ? [...Array.from({ length: t.rh }).keys()] : [...Array.from({ length: t.rh }).keys()].toReversed();
  for (const y of ys) if (Number.isFinite(t.depth[y * t.rw + x])) return y;
  return NaN;
}

/** Height above the eye of the topmost drawn pixel in a column, for something `d` metres away. */
const topM = (t: { rw: number; rh: number; depth: Float32Array }, cam: Camera, x: number, d: number, eyeM = 0) => eyeM + d * Math.tan(rowAngleDeg(cam, edgeRow(t, x, 'top')) / R2D);
const bottomM = (t: { rw: number; rh: number; depth: Float32Array }, cam: Camera, x: number, d: number, eyeM = 0) => eyeM + d * Math.tan(rowAngleDeg(cam, edgeRow(t, x, 'bottom')) / R2D);

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

  it('tilts a skillion down toward roof:direction', () => {
    const cam = camera(0, 0);
    const box: Box = { ring: square(0, 300, 60), heightM: 60, roofShape: RoofShape.Skillion, roofHeightM: 20, roofDirDeg: 90 };
    const west = colOf(-25, 270, cam);
    const east = colOf(25, 270, cam);
    // Down toward the east: the apex edge is the west one, at the full 60 m.
    const down = render([box], cam, ROOF_W, ROOF_H).t;
    expect(topM(down, cam, west, 270)).toBeCloseTo(58.3, 0);
    expect(topM(down, cam, east, 270)).toBeCloseTo(41.7, 0);
    const up = render([{ ...box, roofDirDeg: 270 }], cam, ROOF_W, ROOF_H).t;
    expect(topM(up, cam, west, 270)).toBeCloseTo(41.7, 0);
    expect(topM(up, cam, east, 270)).toBeCloseTo(58.3, 0);
  });

  it('raises a pyramidal roof to its apex over the centroid and to the roof base at the corners', () => {
    // Eye between the roof base and the apex, so the near roof face is the one facing us.
    const cam = camera(0, 0);
    const { t } = render([{ ring: square(0, 300, 60), heightM: 60, roofShape: RoofShape.Pyramidal, roofHeightM: 20 }], cam, ROOF_W, ROOF_H, 50);
    const apex = topM(t, cam, colOf(0, 300, cam), 300, 50);
    const corner = topM(t, cam, colOf(-30, 300, cam), 300, 50);
    expect(apex).toBeGreaterThan(58.5);
    expect(apex).toBeLessThan(61.5);
    expect(corner).toBeGreaterThan(38);
    expect(corner).toBeLessThan(45);
  });

  it('runs a gabled ridge along the long side, and across it with roof:orientation', () => {
    const cam = camera(0, 0);
    const box: Box = { ring: rect(0, 300, 80, 40), heightM: 60, roofShape: RoofShape.Gabled, roofHeightM: 20 };
    const mid = colOf(0, 280, cam);
    const off = colOf(-30, 280, cam);
    // Ridge east-west: the skyline is the ridge, the same height right across the footprint.
    const along = render([box], cam, ROOF_W, ROOF_H).t;
    expect(rowAngleDeg(cam, edgeRow(along, mid, 'top'))).toBeCloseTo(rowAngleDeg(cam, edgeRow(along, off, 'top')), 1);
    // Ridge north-south: the gable end faces us, peaked over the centre and dropping to the eaves.
    const across = render([{ ...box, roofAcross: 1 }], cam, ROOF_W, ROOF_H).t;
    expect(topM(across, cam, mid, 280)).toBeCloseTo(60, 0);
    expect(topM(across, cam, off, 280)).toBeLessThan(50);
  });

  it('keeps a hipped roof inside the gabled silhouette', () => {
    const cam = camera(0, 0);
    const box: Box = { ring: rect(0, 300, 80, 40), heightM: 60, roofHeightM: 20 };
    const gab = render([{ ...box, roofShape: RoofShape.Gabled }], cam, ROOF_W, ROOF_H).t;
    const hip = render([{ ...box, roofShape: RoofShape.Hipped }], cam, ROOF_W, ROOF_H).t;
    let lower = 0;
    for (let x = 0; x < ROOF_W; x++) {
      const g = edgeRow(gab, x, 'top');
      const h = edgeRow(hip, x, 'top');
      if (Number.isNaN(g)) continue;
      expect(Number.isNaN(h) || h >= g).toBe(true);
      if (!Number.isNaN(h) && h > g) lower++;
    }
    // The hips cut the ridge back by half the width at each end, so the ends really do drop.
    expect(lower).toBeGreaterThan(20);
  });

  it('domes up to the roof height over the centroid', () => {
    const cam = camera(0, 0);
    const { t } = render([{ ring: square(0, 300, 60), heightM: 60, roofShape: RoofShape.Dome, roofHeightM: 20 }], cam, ROOF_W, ROOF_H, 55);
    expect(topM(t, cam, colOf(0, 300, cam), 300, 55)).toBeCloseTo(60, 0);
  });

  it('floats a building_part on its min_height, drawing nothing below the base', () => {
    const cam = camera(0, 24);
    const ring = square(0, 300, 60);
    const mid = colOf(0, 270, cam);
    const part = render([{ ring, heightM: 140, minHeightM: 100 }], cam, ROOF_W, ROOF_H).t;
    expect(bottomM(part, cam, mid, 270)).toBeCloseTo(100, 0);
    const solid = render([{ ring, heightM: 140 }], cam, ROOF_W, ROOF_H).t;
    expect(bottomM(solid, cam, mid, 270)).toBeLessThan(60);
  });

  it('picks a default roof height when roof:height is missing', () => {
    const cam = camera(0, 0);
    const ring = square(0, 300, 60);
    const off = colOf(-25, 270, cam);
    const flat = render([{ ring, heightM: 60 }], cam, ROOF_W, ROOF_H).t;
    expect(topM(flat, cam, off, 270)).toBeCloseTo(60, 0);
    // 30° pitch over the 30 m half-width, under the 0.4 × rise ceiling: a 17.3 m roof.
    const gabled = render([{ ring, heightM: 60, roofShape: RoofShape.Gabled, roofAcross: 1 }], cam, ROOF_W, ROOF_H).t;
    expect(topM(gabled, cam, colOf(0, 270, cam), 270)).toBeCloseTo(60, 0);
    expect(topM(gabled, cam, off, 270)).toBeCloseTo(45.6, 0);
  });

  it('degrades a degenerate or over-tall roof to a flat prism instead of throwing', () => {
    const cam = camera(0, 0);
    const bad: Box[] = [
      { ring: [[-10, 290], [10, 290]], heightM: 40, roofShape: RoofShape.Gabled, roofHeightM: 10 },
      { ring: [[NaN, NaN], [10, 290], [0, 310]], heightM: 40, roofShape: RoofShape.Hipped },
      { ring: square(100, 300, 0), heightM: 40, roofShape: RoofShape.Dome, roofHeightM: 10 }
    ];
    expect(render(bad, cam, ROOF_W, ROOF_H).drawn).toBe(0);
    // A roof taller than the walls is clamped, not inverted.
    const tall = render([{ ring: square(0, 300, 60), heightM: 20, roofShape: RoofShape.Gabled, roofHeightM: 30, roofAcross: 1 }], cam, ROOF_W, ROOF_H).t;
    expect(topM(tall, cam, colOf(0, 270, cam), 270)).toBeCloseTo(20, 0);
    let odd = 0;
    for (const d of tall.depth) if (!(d === Infinity || d > 0)) odd++;
    expect(odd).toBe(0);
  });

  it('rasterises a dense tile of mixed roofs well inside the frame budget', () => {
    const shapes = [RoofShape.Flat, RoofShape.Skillion, RoofShape.Gabled, RoofShape.Hipped, RoofShape.Pyramidal, RoofShape.Dome];
    const boxes: Box[] = [];
    for (let i = 0; i < 3000; i++) {
      // Deterministic scatter across a 2 km wedge in front of the eye.
      const e = ((i * 733) % 2000) - 1000;
      const n = 300 + ((i * 457) % 1700);
      boxes.push({ ring: rect(e, n, 20 + (i % 40), 16 + (i % 25)), heightM: 20 + (i % 180), roofShape: shapes[i % shapes.length], roofHeightM: i % 3 === 0 ? 0 : 5 + (i % 12), roofDirDeg: i % 4 === 0 ? NaN : (i * 37) % 360, roofAcross: i % 5 === 0 ? 1 : 0 });
    }
    const cam = camera(0, 5, 24);
    const tile = buildPrisms(batchOf(boxes), PIN, 20);
    const t = makePrismTarget(521, 347);
    const basis = cameraBasis(cam);
    rasterisePrisms(t, cam, basis, [tile], SHADE);
    const t0 = performance.now();
    for (let k = 0; k < 5; k++) rasterisePrisms(t, cam, basis, [tile], SHADE);
    const ms = (performance.now() - t0) / 5;
    console.log(`rasterisePrisms: ${ms.toFixed(1)} ms for 3000 mixed-roof rows at 521x347`);
    expect(ms).toBeLessThan(200);
    expect(extent(t).filled).toBeGreaterThan(10_000);
  });
});
