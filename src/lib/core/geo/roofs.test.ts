import { describe, expect, it } from 'vitest';
import { RoofShape } from '@workers/buildings.protocol';
import { buildRoof, orientedBox, type RoofGeom } from './roofs';

const rect = (w: number, d: number, rotDeg = 0): { e: number[]; n: number[] } => {
  const c = Math.cos((rotDeg * Math.PI) / 180);
  const s = Math.sin((rotDeg * Math.PI) / 180);
  const e: number[] = [];
  const n: number[] = [];
  for (const [x, y] of [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2]
  ]) {
    e.push(x * c - y * s);
    n.push(x * s + y * c);
  }
  return { e, n };
};

/** Highest and lowest u anywhere on the roof polygons. */
function faceRange(g: RoofGeom) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const f of g.faces)
    for (let i = 2; i < f.length; i += 3) {
      lo = Math.min(lo, f[i]);
      hi = Math.max(hi, f[i]);
    }
  return { lo, hi };
}

/** Largest distance of any vertex from the polygon's own Newell plane. */
function flatness(face: number[]): number {
  const [ae, an, au] = face;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0, j = face.length - 3; i < face.length; j = i, i += 3) {
    nx += (face[j + 1] - face[i + 1]) * (face[j + 2] + face[i + 2]);
    ny += (face[j + 2] - face[i + 2]) * (face[j] + face[i]);
    nz += (face[j] - face[i]) * (face[j + 1] + face[i + 1]);
  }
  const l = Math.hypot(nx, ny, nz);
  let worst = 0;
  for (let i = 0; i < face.length; i += 3) worst = Math.max(worst, Math.abs(((face[i] - ae) * nx + (face[i + 1] - an) * ny + (face[i + 2] - au) * nz) / l));
  return worst;
}

describe('orientedBox', () => {
  it('recovers a rotated rectangle', () => {
    const r = rect(80, 40, 30);
    const b = orientedBox(r.e, r.n);
    expect(b).not.toBeNull();
    expect(b?.halfLength).toBeCloseTo(40, 5);
    expect(b?.halfWidth).toBeCloseTo(20, 5);
    expect(Math.abs(Math.atan2(b?.axN ?? 0, b?.axE ?? 0) * (180 / Math.PI)) % 180).toBeCloseTo(30, 4);
    expect(b?.fill).toBeCloseTo(1, 5);
  });

  it('reports how much of its box an L fills', () => {
    const e = [0, 60, 60, 10, 10, 0];
    const n = [0, 0, 10, 10, 60, 60];
    expect(orientedBox(e, n)?.fill).toBeCloseTo(1100 / 3600, 3);
  });
});

describe('buildRoof', () => {
  const r = rect(80, 40);

  it('leaves a flat roof at the apex', () => {
    const g = buildRoof(r.e, r.n, 30, 30, RoofShape.Flat, 10, 45, 0);
    expect(g.ringU).toEqual([30, 30, 30, 30]);
    expect(g.faces).toHaveLength(1);
    expect(faceRange(g)).toEqual({ lo: 30, hi: 30 });
  });

  it('slopes a skillion down toward roof:direction on one plane', () => {
    const g = buildRoof(r.e, r.n, 30, 30, RoofShape.Skillion, 10, 90, 0);
    // Down to the east: the two west vertices keep the apex, the east pair drop a full roof height.
    expect(g.ringU[0]).toBeCloseTo(30, 6);
    expect(g.ringU[1]).toBeCloseTo(20, 6);
    expect(g.ringU[2]).toBeCloseTo(20, 6);
    expect(g.ringU[3]).toBeCloseTo(30, 6);
    expect(flatness(g.faces[0])).toBeLessThan(1e-9);
  });

  it('runs a gabled ridge along the long side and inserts the gable peaks', () => {
    const g = buildRoof(r.e, r.n, 30, 30, RoofShape.Gabled, 10, NaN, 0);
    // Ridge east-west: the eaves stay at the roof base and the two gable ends gain a peak.
    expect(g.ringE).toHaveLength(6);
    expect(faceRange(g)).toEqual({ lo: 20, hi: 30 });
    expect(g.faces).toHaveLength(2);
    expect(Math.max(...g.ringU)).toBeCloseTo(30, 6);
    expect(Math.min(...g.ringU)).toBeCloseTo(20, 6);
    for (const f of g.faces) expect(flatness(f)).toBeLessThan(1e-9);
  });

  it('turns the ridge across the long side with roof:orientation', () => {
    const across = buildRoof(r.e, r.n, 30, 30, RoofShape.Gabled, 10, NaN, 1);
    // Ridge north-south now, so the peaks land on the long walls instead of the short ones.
    const peaks = across.ringE.filter((_, i) => across.ringU[i] > 29.9);
    expect(peaks).toHaveLength(2);
    expect(Math.abs(peaks[0])).toBeCloseTo(0, 6);
  });

  it('caps a pyramid with one triangle per ring edge', () => {
    const g = buildRoof(r.e, r.n, 30, 30, RoofShape.Pyramidal, 10, NaN, 0);
    expect(g.faces).toHaveLength(4);
    expect(g.ringU).toEqual([20, 20, 20, 20]);
    expect(faceRange(g)).toEqual({ lo: 20, hi: 30 });
  });

  it('hips a rectangle into two trapezoids and two end triangles', () => {
    const g = buildRoof(r.e, r.n, 30, 30, RoofShape.Hipped, 10, NaN, 0);
    expect(g.faces).toHaveLength(4);
    expect(g.faces.map((f) => f.length / 3).toSorted()).toEqual([3, 3, 4, 4]);
    expect(g.ringU).toEqual([20, 20, 20, 20]);
    expect(faceRange(g)).toEqual({ lo: 20, hi: 30 });
    for (const f of g.faces) expect(flatness(f)).toBeLessThan(1e-9);
  });

  it('falls back to a gable where a footprint is too far from its bounding box to hip', () => {
    const e = [0, 60, 60, 10, 10, 0];
    const n = [0, 0, 10, 10, 60, 60];
    const g = buildRoof(e, n, 30, 30, RoofShape.Hipped, 10, NaN, 0);
    expect(g.faces.length).toBeGreaterThanOrEqual(1);
    expect(faceRange(g).hi).toBeLessThanOrEqual(30);
    expect(faceRange(g).lo).toBeGreaterThanOrEqual(20);
  });

  it('stacks a dome into frustum bands that meet at the centroid', () => {
    const g = buildRoof(r.e, r.n, 30, 30, RoofShape.Dome, 10, NaN, 0);
    expect(g.faces).toHaveLength(16);
    expect(faceRange(g)).toEqual({ lo: 20, hi: 30 });
    // Every band edge is a trapezoid between two parallel segments, so each face is planar.
    for (const f of g.faces) expect(flatness(f)).toBeLessThan(1e-9);
  });

  it('guesses a roof height from the pitch and the short side', () => {
    // 30° over the 20 m half-width is 11.5 m, under the 0.4 × 100 m rise ceiling.
    const g = buildRoof(r.e, r.n, 100, 100, RoofShape.Gabled, 0, NaN, 0);
    expect(100 - faceRange(g).lo).toBeCloseTo(20 * Math.tan(Math.PI / 6), 4);
    // A hemisphere is as tall as the footprint's half short side.
    const d = buildRoof(r.e, r.n, 100, 100, RoofShape.Dome, 0, NaN, 0);
    expect(100 - faceRange(d).lo).toBeCloseTo(20, 6);
  });

  it('clamps a roof that would swallow its walls and flattens a degenerate ring', () => {
    const g = buildRoof(r.e, r.n, 10, 10, RoofShape.Gabled, 40, NaN, 0);
    expect(faceRange(g).lo).toBeCloseTo(0.5, 6);
    const two = buildRoof([0, 10], [0, 0], 10, 10, RoofShape.Hipped, 4, NaN, 0);
    expect(two.faces[0]).toEqual([0, 0, 10, 10, 0, 10]);
    const nan = buildRoof([0, 10, 5], [0, 0, NaN], 10, NaN, RoofShape.Dome, 4, NaN, 0);
    expect(nan.faces).toHaveLength(1);
  });
});
