/** Flat-shaded landmark solids: footprint, faces and back-face culling in a local metre frame. */

import { MarkerShape } from '@core/plan';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const CYLINDER_SIDES = 16;

/** Local east/north/up offset from the marker point, at its ground level. */
export interface SolidVertex {
  e: number;
  n: number;
  u: number;
}

export interface SolidFace {
  /** Indices into `vertices`, wound counter-clockwise seen from outside. */
  v: number[];
  /** Unit outward normal. */
  normal: SolidVertex;
  /** Compass bearing of the outward normal; null when the face faces up. */
  bearingDeg: number | null;
}

export interface Solid {
  vertices: SolidVertex[];
  faces: SolidFace[];
}

export interface SolidDims {
  widthM: number;
  depthM: number;
  heightM: number;
  rotationDeg: number;
}

/** Rotate clockwise from north, i.e. the way a footprint turns on a map. */
function rotate(e: number, n: number, deg: number): { e: number; n: number } {
  const θ = deg * D2R;
  const c = Math.cos(θ);
  const s = Math.sin(θ);
  return { e: e * c + n * s, n: n * c - e * s };
}

/** Footprint outline, counter-clockwise seen from above; unrotated width runs east, depth north. */
export function footprint(shape: MarkerShape, dims: SolidDims): SolidVertex[] {
  const a = Math.max(0, dims.widthM) / 2;
  const b = Math.max(0, shape === MarkerShape.Box ? dims.depthM : dims.widthM) / 2;
  const raw: [number, number][] =
    shape === MarkerShape.Cylinder
      ? Array.from({ length: CYLINDER_SIDES }, (_, k) => {
          const φ = (k * 2 * Math.PI) / CYLINDER_SIDES;
          return [a * Math.cos(φ), a * Math.sin(φ)] as [number, number];
        })
      : [
          [a, -b],
          [a, b],
          [-a, b],
          [-a, -b]
        ];
  return raw.map(([e, n]) => {
    const r = rotate(e, n, dims.rotationDeg);
    return { e: r.e, n: r.n, u: 0 };
  });
}

function normalOf(vs: SolidVertex[], idx: number[]): SolidFace['normal'] {
  const [p, q, r] = [vs[idx[0]], vs[idx[1]], vs[idx[2]]];
  const ax = q.e - p.e;
  const ay = q.n - p.n;
  const az = q.u - p.u;
  const bx = r.e - p.e;
  const by = r.n - p.n;
  const bz = r.u - p.u;
  const e = ay * bz - az * by;
  const n = az * bx - ax * bz;
  const u = ax * by - ay * bx;
  const len = Math.hypot(e, n, u) || 1;
  return { e: e / len, n: n / len, u: u / len };
}

function face(vs: SolidVertex[], idx: number[]): SolidFace {
  const normal = normalOf(vs, idx);
  const flat = Math.hypot(normal.e, normal.n);
  return { v: idx, normal, bearingDeg: flat < 1e-6 ? null : (((Math.atan2(normal.e, normal.n) * R2D) % 360) + 360) % 360 };
}

/** Vertices and outward-wound faces for a marker's shape; Bar has no solid. */
export function solidOf(shape: MarkerShape, dims: SolidDims): Solid {
  if (shape === MarkerShape.Bar || dims.widthM <= 0 || dims.heightM <= 0) return { vertices: [], faces: [] };
  const base = footprint(shape, dims);
  const n = base.length;
  if (shape === MarkerShape.Spire) {
    const vertices = [...base, { e: 0, n: 0, u: dims.heightM }];
    const faces = base.map((_, i) => face(vertices, [i, (i + 1) % n, n]));
    return { vertices, faces };
  }
  const vertices = [...base, ...base.map((p) => ({ e: p.e, n: p.n, u: dims.heightM }))];
  const faces = base.map((_, i) => face(vertices, [i, (i + 1) % n, n + ((i + 1) % n), n + i]));
  faces.push(face(vertices, base.map((_, i) => n + i)));
  return { vertices, faces };
}

export interface PlacedFace extends SolidFace {
  /** Mean distance from the eye to the face's vertices, metres. */
  depthM: number;
}

/** Faces whose outward side holds the eye, farthest first (painter's order). */
export function facesToward(solid: Solid, eye: SolidVertex): PlacedFace[] {
  const out: PlacedFace[] = [];
  for (const f of solid.faces) {
    let ce = 0;
    let cn = 0;
    let cu = 0;
    for (const i of f.v) {
      ce += solid.vertices[i].e;
      cn += solid.vertices[i].n;
      cu += solid.vertices[i].u;
    }
    ce /= f.v.length;
    cn /= f.v.length;
    cu /= f.v.length;
    if (f.normal.e * (eye.e - ce) + f.normal.n * (eye.n - cn) + f.normal.u * (eye.u - cu) <= 0) continue;
    let depthM = 0;
    for (const i of f.v) {
      const p = solid.vertices[i];
      depthM += Math.hypot(p.e - eye.e, p.n - eye.n, p.u - eye.u);
    }
    out.push({ ...f, depthM: depthM / f.v.length });
  }
  return out.toSorted((a, b) => b.depthM - a.depthM);
}

/** Polar offset of a local vertex from the marker point, for `destination()`. */
export function polarOf(v: SolidVertex): { bearingDeg: number; distM: number } {
  return { bearingDeg: (((Math.atan2(v.e, v.n) * R2D) % 360) + 360) % 360, distM: Math.hypot(v.e, v.n) };
}

/** Lambert-ish flat shade, 0..1, for a face lit from `lightAzDeg`; up-facing faces read brightest. */
export function faceShade(f: SolidFace, lightAzDeg: number): number {
  if (f.bearingDeg == null) return 0.95;
  return 0.3 + 0.6 * (0.5 + 0.5 * Math.cos((f.bearingDeg - lightAzDeg) * D2R));
}
