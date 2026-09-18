import { describe, expect, it } from 'vitest';
import { cameraBasis, type Camera } from '@core/optics/projection';
import { prismClipMatrix } from './prismGl';

const CAM: Camera = { azimuthDeg: 37, elevationDeg: -4, focalMm: 50, frameWmm: 36, frameHmm: 24 };

/** Column-major multiply, matching gl_Position = M * vec4(e, n, u, 1). */
function project(m: Float32Array, p: readonly [number, number, number]) {
  const out = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) out[r] = m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r];
  return { x: out[0] / out[3], y: out[1] / out[3], z: out[2] / out[3], w: out[3] };
}

/** Eye-relative point at a sensor offset in mm, `distM` along the optical axis. */
function atSensor(xMm: number, yMm: number, distM: number): [number, number, number] {
  const b = cameraBasis(CAM);
  const s = distM / CAM.focalMm;
  return [
    distM * b.forward.x + s * xMm * b.right.x + s * yMm * b.up.x,
    distM * b.forward.y + s * xMm * b.right.y + s * yMm * b.up.y,
    distM * b.forward.z + s * xMm * b.right.z + s * yMm * b.up.z
  ];
}

describe('prismClipMatrix', () => {
  const m = prismClipMatrix(CAM, cameraBasis(CAM));

  it('puts the optical axis at the centre of the frame', () => {
    const q = project(m, atSensor(0, 0, 400));
    expect(q.x).toBeCloseTo(0, 6);
    expect(q.y).toBeCloseTo(0, 6);
  });

  it('maps the sensor corners to the clip cube edges', () => {
    const q = project(m, atSensor(CAM.frameWmm / 2, CAM.frameHmm / 2, 250));
    expect(q.x).toBeCloseTo(1, 5);
    expect(q.y).toBeCloseTo(1, 5);
    const r = project(m, atSensor(-CAM.frameWmm / 4, -CAM.frameHmm / 2, 900));
    expect(r.x).toBeCloseTo(-0.5, 5);
    expect(r.y).toBeCloseTo(-1, 5);
  });

  it('divides by the distance along the optical axis', () => {
    expect(project(m, atSensor(3, -2, 731)).w).toBeCloseTo(731, 3);
  });

  it('is reversed-Z: nearer points get the greater depth', () => {
    const zs = [30, 100, 1000, 20_000].map((d) => project(m, atSensor(5, 5, d)).z);
    for (let i = 1; i < zs.length; i++) expect(zs[i]).toBeLessThan(zs[i - 1]);
    expect(zs[zs.length - 1]).toBeGreaterThan(-1);
    expect(zs[0]).toBeLessThan(1);
  });
});

type P3 = [number, number, number];

/** Newell normal of a ring, pointing out of the side it winds counter-clockwise about. */
function newell(ring: readonly P3[]): P3 {
  const out: P3 = [0, 0, 0];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    out[0] += (a[1] - b[1]) * (a[2] + b[2]);
    out[1] += (a[2] - b[2]) * (a[0] + b[0]);
    out[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return out;
}

/** Signed area of the projected ring; positive is counter-clockwise on screen. */
function screenArea(m: Float32Array, ring: readonly P3[]): number {
  const p = ring.map((v) => project(m, v));
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j].x * p[i].y - p[i].x * p[j].y;
  return a / 2;
}

describe('face winding', () => {
  const m = prismClipMatrix(CAM, cameraBasis(CAM));
  // A square panel 300 m down the optical axis, 20 mm of sensor across.
  const quad = (order: readonly [number, number][]): P3[] => order.map(([a, b]) => atSensor(a * 10, b * 10, 300));
  const square: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

  it('projects a face whose outward normal points back at the eye counter-clockwise', () => {
    const rings = [quad(square), quad(square.toReversed())];
    const facing = rings.filter((r) => newell(r)[0] * r[0][0] + newell(r)[1] * r[0][1] + newell(r)[2] * r[0][2] < 0);
    expect(facing).toHaveLength(1);
    expect(screenArea(m, facing[0])).toBeGreaterThan(0);
    expect(screenArea(m, facing[0].toReversed())).toBeLessThan(0);
  });
});
