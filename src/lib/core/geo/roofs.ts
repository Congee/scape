/** OSM Simple 3D Buildings roof shapes turned into wall-top heights and planar roof polygons. */

import { RoofShape } from '@workers/buildings.protocol';

const D2R = Math.PI / 180;
/** Pitch assumed for a ridged roof whose `roof:height` is missing. */
const DEFAULT_PITCH = Math.tan(30 * D2R);
/** Ceiling on a guessed roof height, as a fraction of the row's rise. */
const DEFAULT_RISE_FRAC = 0.4;
/** A roof never eats the whole wall. */
const MAX_RISE_FRAC = 0.95;
/** Below this footprint-over-bbox fill a hip's four faces would not cover the ring. */
const HIP_FILL_MIN = 0.6;
/** Stacked bands of a dome; the top one collapses to the apex. */
const DOME_BANDS = 4;

/** One row's roof: the footprint its walls rise to, and the polygons that close the top. */
export interface RoofGeom {
  /** Footprint in eye-relative metres, with any ridge crossings inserted. */
  ringE: number[];
  ringN: number[];
  /** Wall top at each ring vertex. */
  ringU: number[];
  /** Roof polygons, each a flat `[e, n, u, ...]`; planar, winding unspecified. */
  faces: number[][];
}

/** Minimum-area bounding box of a ring, long axis first. */
export interface Obb {
  cE: number;
  cN: number;
  /** Unit vector along the longer side. */
  axE: number;
  axN: number;
  halfLength: number;
  halfWidth: number;
  /** Ring area over box area, 0..1; a rectangle is 1. */
  fill: number;
}

function ringArea2(e: readonly number[], n: readonly number[]): number {
  let a = 0;
  for (let i = 0, j = e.length - 1; i < e.length; j = i++) a += e[j] * n[i] - e[i] * n[j];
  return a;
}

/** Rotating-calipers minimum-area box; null when the ring has no extent. */
export function orientedBox(e: readonly number[], n: readonly number[]): Obb | null {
  const len = e.length;
  if (len < 3) return null;
  // Long rings are smooth enough that every few edges gives the same box.
  const step = Math.max(1, len >> 6);
  let bestArea = Infinity;
  let bDx = 1;
  let bDy = 0;
  let bA0 = 0;
  let bA1 = 0;
  let bC0 = 0;
  let bC1 = 0;
  for (let j = 0; j < len; j += step) {
    const k = (j + 1) % len;
    let dx = e[k] - e[j];
    let dy = n[k] - n[j];
    const l = Math.hypot(dx, dy);
    if (!(l > 1e-9)) continue;
    dx /= l;
    dy /= l;
    let a0 = Infinity;
    let a1 = -Infinity;
    let c0 = Infinity;
    let c1 = -Infinity;
    for (let i = 0; i < len; i++) {
      const a = e[i] * dx + n[i] * dy;
      const c = -e[i] * dy + n[i] * dx;
      if (a < a0) a0 = a;
      if (a > a1) a1 = a;
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
    }
    const area = (a1 - a0) * (c1 - c0);
    if (area < bestArea) {
      bestArea = area;
      bDx = dx;
      bDy = dy;
      bA0 = a0;
      bA1 = a1;
      bC0 = c0;
      bC1 = c1;
    }
  }
  if (!Number.isFinite(bestArea)) return null;
  const ma = (bA0 + bA1) / 2;
  const mc = (bC0 + bC1) / 2;
  const cE = ma * bDx - mc * bDy;
  const cN = ma * bDy + mc * bDx;
  const ha = (bA1 - bA0) / 2;
  const hc = (bC1 - bC0) / 2;
  const fill = bestArea > 1e-9 ? Math.min(1, Math.abs(ringArea2(e, n)) / 2 / bestArea) : 0;
  return ha >= hc
    ? { cE, cN, axE: bDx, axN: bDy, halfLength: ha, halfWidth: hc, fill }
    : { cE, cN, axE: -bDy, axN: bDx, halfLength: hc, halfWidth: ha, fill };
}

/** Sutherland-Hodgman clip of a ring against the half-plane `a·e + b·n + c >= 0`. */
function clipHalf(pe: readonly number[], pn: readonly number[], a: number, b: number, c: number): { e: number[]; n: number[] } {
  const oe: number[] = [];
  const on: number[] = [];
  // A vertex sitting on the cut would otherwise come out twice, once as itself and once as the crossing.
  const put = (ve: number, vn: number) => {
    const k = oe.length - 1;
    if (k >= 0 && Math.abs(oe[k] - ve) < 1e-9 && Math.abs(on[k] - vn) < 1e-9) return;
    oe.push(ve);
    on.push(vn);
  };
  const len = pe.length;
  for (let i = 0, j = len - 1; i < len; j = i++) {
    const dj = a * pe[j] + b * pn[j] + c;
    const di = a * pe[i] + b * pn[i] + c;
    if (di >= 0 !== dj >= 0) {
      const t = dj / (dj - di);
      put(pe[j] + t * (pe[i] - pe[j]), pn[j] + t * (pn[i] - pn[j]));
    }
    if (di >= 0) put(pe[i], pn[i]);
  }
  const last = oe.length - 1;
  if (last > 0 && Math.abs(oe[last] - oe[0]) < 1e-9 && Math.abs(on[last] - on[0]) < 1e-9) {
    oe.pop();
    on.pop();
  }
  return { e: oe, n: on };
}

/** The ring with its crossings of `a·e + b·n + c = 0` inserted as vertices; ring order is preserved. */
function insertCrossings(pe: readonly number[], pn: readonly number[], a: number, b: number, c: number): { e: number[]; n: number[]; hits: number } {
  const oe: number[] = [];
  const on: number[] = [];
  let hits = 0;
  const len = pe.length;
  for (let i = 0, j = len - 1; i < len; j = i++) {
    const dj = a * pe[j] + b * pn[j] + c;
    const di = a * pe[i] + b * pn[i] + c;
    if (di > 0 !== dj > 0 && dj !== di) {
      const t = dj / (dj - di);
      oe.push(pe[j] + t * (pe[i] - pe[j]));
      on.push(pn[j] + t * (pn[i] - pn[j]));
      hits++;
    }
    oe.push(pe[i]);
    on.push(pn[i]);
  }
  return { e: oe, n: on, hits };
}

/** Area centroid of a ring, falling back to the vertex mean for a degenerate one. */
function centroid(e: readonly number[], n: readonly number[]): { e: number; n: number } {
  let a = 0;
  let ce = 0;
  let cn = 0;
  for (let i = 0, j = e.length - 1; i < e.length; j = i++) {
    const cr = e[j] * n[i] - e[i] * n[j];
    a += cr;
    ce += (e[j] + e[i]) * cr;
    cn += (n[j] + n[i]) * cr;
  }
  if (Math.abs(a) > 1e-9) return { e: ce / (3 * a), n: cn / (3 * a) };
  let me = 0;
  let mn = 0;
  for (let i = 0; i < e.length; i++) {
    me += e[i];
    mn += n[i];
  }
  return { e: me / e.length, n: mn / n.length };
}

function liftRing(e: readonly number[], n: readonly number[], u: (e: number, n: number) => number): number[] {
  const face: number[] = [];
  for (let i = 0; i < e.length; i++) face.push(e[i], n[i], u(e[i], n[i]));
  return face;
}

function flatRoof(ringE: number[], ringN: number[], u: number): RoofGeom {
  return { ringE, ringN, ringU: ringE.map(() => u), faces: [liftRing(ringE, ringN, () => u)] };
}

/**
 * Wall tops and roof polygons for one row. `uApex` is the row's top in eye-relative metres and
 * `rise` its wall height; everything degenerate falls back to a flat roof so a bad row still draws.
 */
export function buildRoof(ringE: readonly number[], ringN: readonly number[], rise: number, uApex: number, shape: number, roofHeightM: number, roofDirDeg: number, roofAcross: number): RoofGeom {
  const e = ringE.slice();
  const n = ringN.slice();
  if (e.length < 3 || !Number.isFinite(uApex) || !Number.isFinite(rise)) return flatRoof(e, n, uApex);
  if (shape === RoofShape.Flat || shape === RoofShape.Other) return flatRoof(e, n, uApex);
  const box = orientedBox(e, n);
  let rh = roofHeightM;
  if (!(rh > 0)) {
    if (!box) return flatRoof(e, n, uApex);
    rh = shape === RoofShape.Dome ? box.halfWidth : Math.min(DEFAULT_RISE_FRAC * Math.max(0, rise), DEFAULT_PITCH * box.halfWidth);
  }
  rh = Math.min(rh, MAX_RISE_FRAC * rise);
  if (!(rh > 0)) return flatRoof(e, n, uApex);
  const base = uApex - rh;

  switch (shape) {
    case RoofShape.Skillion: {
      let dx: number;
      let dy: number;
      if (Number.isFinite(roofDirDeg)) {
        dx = Math.sin(roofDirDeg * D2R);
        dy = Math.cos(roofDirDeg * D2R);
      } else if (box) {
        dx = box.axE;
        dy = box.axN;
      } else return flatRoof(e, n, uApex);
      let p0 = Infinity;
      let p1 = -Infinity;
      for (let i = 0; i < e.length; i++) {
        const p = e[i] * dx + n[i] * dy;
        if (p < p0) p0 = p;
        if (p > p1) p1 = p;
      }
      const span = p1 - p0;
      if (!(span > 1e-6)) return flatRoof(e, n, uApex);
      // One plane: the apex sits on the edge farthest against the slope direction.
      const at = (ve: number, vn: number) => uApex - (rh * (ve * dx + vn * dy - p0)) / span;
      const ringU = e.map((ve, i) => at(ve, n[i]));
      return { ringE: e, ringN: n, ringU, faces: [liftRing(e, n, at)] };
    }
    case RoofShape.Pyramidal: {
      const c = centroid(e, n);
      const faces: number[][] = [];
      for (let i = 0, j = e.length - 1; i < e.length; j = i++) faces.push([e[j], n[j], base, e[i], n[i], base, c.e, c.n, uApex]);
      return { ringE: e, ringN: n, ringU: e.map(() => base), faces };
    }
    case RoofShape.Hipped: {
      const hip = box && box.fill >= HIP_FILL_MIN ? hipped(e, n, box, base, rh) : null;
      return hip ?? gabled(e, n, box, base, rh, roofDirDeg, roofAcross);
    }
    case RoofShape.Dome:
      return dome(e, n, base, rh);
    case RoofShape.Gabled:
      return gabled(e, n, box, base, rh, roofDirDeg, roofAcross);
    default:
      return flatRoof(e, n, uApex);
  }
}

/** Across-the-ridge unit vector: `roof:direction` when given, else the bbox axis `roof:orientation` picks. */
function acrossAxis(box: Obb | null, roofDirDeg: number, roofAcross: number): { x: number; y: number } | null {
  if (Number.isFinite(roofDirDeg)) return { x: Math.sin(roofDirDeg * D2R), y: Math.cos(roofDirDeg * D2R) };
  if (!box) return null;
  // Default ridge runs along the long side, so the slope is across the short one.
  return roofAcross ? { x: box.axE, y: box.axN } : { x: -box.axN, y: box.axE };
}

function gabled(e: number[], n: number[], box: Obb | null, base: number, rh: number, roofDirDeg: number, roofAcross: number): RoofGeom {
  const ax = acrossAxis(box, roofDirDeg, roofAcross);
  if (!ax) return flatRoof(e, n, base + rh);
  // The ridge runs through the bbox centre, or the footprint's centroid when there is no box.
  const mid = box ? { e: box.cE, n: box.cN } : centroid(e, n);
  const off = -(ax.x * mid.e + ax.y * mid.n);
  let halfWidth = 0;
  for (let i = 0; i < e.length; i++) halfWidth = Math.max(halfWidth, Math.abs(e[i] * ax.x + n[i] * ax.y + off));
  if (!(halfWidth > 1e-6)) return flatRoof(e, n, base);
  const cut = insertCrossings(e, n, ax.x, ax.y, off);
  // A ridge that misses the footprint would leave the roof open; a flat cap is the safe answer.
  if (cut.hits === 0) return flatRoof(cut.e, cut.n, base);
  const ringU = cut.e.map((ve, i) => base + rh * Math.max(0, 1 - Math.abs(ve * ax.x + cut.n[i] * ax.y + off) / halfWidth));
  const faces: number[][] = [];
  for (const s of [1, -1]) {
    const side = clipHalf(cut.e, cut.n, s * ax.x, s * ax.y, s * off);
    if (side.e.length < 3) continue;
    faces.push(liftRing(side.e, side.n, (ve, vn) => base + rh * (1 - (s * (ve * ax.x + vn * ax.y + off)) / halfWidth)));
  }
  if (faces.length === 0) return flatRoof(cut.e, cut.n, base);
  return { ringE: cut.e, ringN: cut.n, ringU, faces };
}

/** Tent with 45° hip ends: two side trapezoids and two end triangles, clipped out of the ring. */
function hipped(e: number[], n: number[], box: Obb, base: number, rh: number): RoofGeom | null {
  const hw = box.halfWidth;
  if (!(hw > 1e-6)) return null;
  const l0 = box.halfLength - hw;
  // Ring in box coordinates: along the long axis, across the short one.
  const pa: number[] = [];
  const pc: number[] = [];
  for (let i = 0; i < e.length; i++) {
    const de = e[i] - box.cE;
    const dn = n[i] - box.cN;
    pa.push(de * box.axE + dn * box.axN);
    pc.push(-de * box.axN + dn * box.axE);
  }
  const toWorld = (a: number, c: number, u: number) => [box.cE + a * box.axE - c * box.axN, box.cN + a * box.axN + c * box.axE, u];
  const faces: number[][] = [];
  // Each face is the ring clipped to one convex region of the tent, lifted onto that region's plane.
  const regions: { half: [number, number, number][]; u: (a: number, c: number) => number }[] = [
    {
      half: [
        [0, 1, 0],
        [-1, 1, l0],
        [1, 1, l0]
      ],
      u: (_a, c) => base + rh * (1 - c / hw)
    },
    {
      half: [
        [0, -1, 0],
        [-1, -1, l0],
        [1, -1, l0]
      ],
      u: (_a, c) => base + rh * (1 + c / hw)
    },
    {
      half: [
        [1, -1, -l0],
        [1, 1, -l0]
      ],
      u: (a) => base + rh * (1 - (a - l0) / hw)
    },
    {
      half: [
        [-1, 1, -l0],
        [-1, -1, -l0]
      ],
      u: (a) => base + rh * (1 + (a + l0) / hw)
    }
  ];
  for (const r of regions) {
    let ce = pa;
    let cn = pc;
    for (const [a, b, k] of r.half) {
      const cl = clipHalf(ce, cn, a, b, k);
      ce = cl.e;
      cn = cl.n;
      if (ce.length < 3) break;
    }
    if (ce.length < 3) continue;
    const face: number[] = [];
    for (let i = 0; i < ce.length; i++) face.push(...toWorld(ce[i], cn[i], r.u(ce[i], cn[i])));
    faces.push(face);
  }
  if (faces.length === 0) return null;
  return { ringE: e, ringN: n, ringU: e.map(() => base), faces };
}

/** Hemisphere as stacked frustums; each band edge is a trapezoid between two parallel segments. */
function dome(e: number[], n: number[], base: number, rh: number): RoofGeom {
  const c = centroid(e, n);
  const faces: number[][] = [];
  const len = e.length;
  for (let k = 0; k < DOME_BANDS; k++) {
    const t0 = (k * Math.PI) / 2 / DOME_BANDS;
    const t1 = ((k + 1) * Math.PI) / 2 / DOME_BANDS;
    const s0 = Math.cos(t0);
    const s1 = Math.cos(t1);
    const u0 = base + rh * Math.sin(t0);
    const u1 = base + rh * Math.sin(t1);
    for (let i = 0, j = len - 1; i < len; j = i++) {
      const aj = [c.e + s0 * (e[j] - c.e), c.n + s0 * (n[j] - c.n), u0];
      const ai = [c.e + s0 * (e[i] - c.e), c.n + s0 * (n[i] - c.n), u0];
      if (k === DOME_BANDS - 1) faces.push([...aj, ...ai, c.e, c.n, u1]);
      else faces.push([...aj, ...ai, c.e + s1 * (e[i] - c.e), c.n + s1 * (n[i] - c.n), u1, c.e + s1 * (e[j] - c.e), c.n + s1 * (n[j] - c.n), u1]);
    }
  }
  return { ringE: e, ringN: n, ringU: e.map(() => base), faces };
}
