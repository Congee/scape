/** OpenStreetMap footprints extruded to closed prisms in the viewfinder's eye-relative frame. */

import type { CameraBasis } from '@core/optics/projection';
import type { BuildingBatch } from '@workers/buildings.protocol';
import { curvatureDropM, type LngLat } from './geodesy';
import { frameAt } from './pinFrame';
import { buildRoof } from './roofs';

const R2D = 180 / Math.PI;
/** Faces are clipped in front of this depth along the optical axis, so nothing beside or behind the eye projects. */
export const NEAR_M = 0.5;
/** Smallest projected extent worth a face, pixels. */
export const MIN_PX = 0.75;
/** Far-first level of detail: below this projected area a building is a speck, not a volume. */
export const MIN_AREA_PX = 3;
export const ROOF_SHADE = 0.92;
/** Same haze falloff the terrain's ground colour uses. */
export const HAZE_M = 45_000;

/**
 * One tile's prisms in eye-relative metres: east, north, and up with the curvature drop already
 * removed. The eye sits at the origin and never moves while a tile is cached, but the prism is
 * closed and eye-independent: the shadow pass casts from faces the camera never sees.
 */
export interface PrismTile {
  count: number;
  /** Wall ring of building i is [ringStart[i], ringStart[i + 1]); the ring is not closed. */
  ringStart: Int32Array;
  e: Float32Array;
  n: Float32Array;
  uBase: Float32Array;
  /** Wall top at each vertex; it follows the roof for the shapes whose eaves are not level. */
  uTop: Float32Array;
  /** Unit outward normal and compass bearing of the wall starting at each vertex; `wOk` clears the degenerate ones. */
  wNx: Float32Array;
  wNy: Float32Array;
  wBear: Float32Array;
  wOk: Uint8Array;
  /** Roof faces of building i are [faceStart[i], faceStart[i + 1]). */
  faceStart: Int32Array;
  /** Vertices of face k are [faceVert[k], faceVert[k + 1]) in fE/fN/fU. */
  faceVert: Int32Array;
  fE: Float32Array;
  fN: Float32Array;
  fU: Float32Array;
  /** Plane of face k: N·P = fPc, N pointing up; fBear/fHor describe its horizontal tilt. */
  fNx: Float32Array;
  fNy: Float32Array;
  fNz: Float32Array;
  fPc: Float32Array;
  fBear: Float32Array;
  fHor: Float32Array;
  /** Bounding sphere per building, for the frustum cull. */
  cE: Float32Array;
  cN: Float32Array;
  cU: Float32Array;
  radiusM: Float32Array;
  /** Ground distance from the eye to the centroid. */
  distM: Float32Array;
  /** Widest horizontal extent and base-to-top rise, for the sub-pixel cull. */
  spanM: Float32Array;
  riseM: Float32Array;
  /** Bounding sphere of the whole tile, so a tile outside the frame costs one test. */
  hull: { e: number; n: number; u: number; r: number };
}

export interface PrismShading {
  /** Sun azimuth while the sun is up, otherwise a key light behind the camera. */
  lightAzDeg: number;
  /** Far ground colour the haze blends toward, 0..255. */
  hazeRgb: readonly number[];
  /** How dark the sky is, 0..1; towers stay light so they read against it. */
  night: number;
  /** Buildings past this ground distance are dropped. */
  rangeM: number;
}

/**
 * Eye-relative prisms for one tile. A vertex lands where `elevationAngleDeg(d, dz)` puts it, so it
 * lines up with the terrain sweep and the target; recompute only when the camera location moves.
 */
export function buildPrisms(batch: BuildingBatch, pin: LngLat, eyeM: number): PrismTile {
  const nb = batch.count;
  const frame = frameAt(pin);
  const ringStart = new Int32Array(nb + 1);
  const faceStart = new Int32Array(nb + 1);
  const cE = new Float32Array(nb);
  const cN = new Float32Array(nb);
  const cU = new Float32Array(nb);
  const radiusM = new Float32Array(nb);
  const distM = new Float32Array(nb);
  const spanM = new Float32Array(nb);
  const riseM = new Float32Array(nb);
  const E: number[] = [];
  const N: number[] = [];
  const UB: number[] = [];
  const UT: number[] = [];
  const WNX: number[] = [];
  const WNY: number[] = [];
  const WBE: number[] = [];
  const WOK: number[] = [];
  const faceVert: number[] = [0];
  const FE: number[] = [];
  const FN: number[] = [];
  const FU: number[] = [];
  const FNX: number[] = [];
  const FNY: number[] = [];
  const FNZ: number[] = [];
  const FPC: number[] = [];
  const FBE: number[] = [];
  const FHO: number[] = [];
  // Scratch for the row being projected; the roof is built in a drop-free frame.
  const re: number[] = [];
  const rn: number[] = [];
  let he0 = Infinity;
  let he1 = -Infinity;
  let hn0 = Infinity;
  let hn1 = -Infinity;
  let hu0 = Infinity;
  let hu1 = -Infinity;
  for (let i = 0; i < nb; i++) {
    ringStart[i] = E.length;
    faceStart[i] = faceVert.length - 1;
    const g = batch.groundM[i];
    // No DEM tile: sea level, which is where most of these footprints sit anyway.
    const ground = Number.isNaN(g) ? 0 : Math.max(g, 0);
    const uBase0 = ground + batch.minHeightM[i] - eyeM;
    const uApex0 = ground + batch.heightM[i] - eyeM;
    if (!Number.isFinite(uBase0) || !Number.isFinite(uApex0)) continue;
    re.length = 0;
    rn.length = 0;
    let ok = true;
    for (let j = batch.ringStart[i]; j < batch.ringStart[i + 1]; j++) {
      const [ve, vn] = frame.toEn(batch.lng[j], batch.lat[j]);
      if (!Number.isFinite(ve) || !Number.isFinite(vn)) {
        ok = false;
        break;
      }
      re.push(ve);
      rn.push(vn);
    }
    if (!ok || re.length < 3) continue;
    const roof = buildRoof(re, rn, uApex0 - uBase0, uApex0, batch.roofShape[i], batch.roofHeightM[i], batch.roofDirDeg[i], batch.roofAcross[i]);
    const len = roof.ringE.length;
    if (len < 3) continue;
    let area = 0;
    for (let j = 0, k = len - 1; j < len; k = j++) area += roof.ringE[k] * roof.ringN[j] - roof.ringE[j] * roof.ringN[k];
    const wind = area >= 0 ? 1 : -1;
    let e0 = Infinity;
    let e1 = -Infinity;
    let n0 = Infinity;
    let n1 = -Infinity;
    let u0 = Infinity;
    let u1 = -Infinity;
    for (let j = 0; j < len; j++) {
      const ve = roof.ringE[j];
      const vn = roof.ringN[j];
      const drop = curvatureDropM(Math.hypot(ve, vn));
      const ub = uBase0 - drop;
      const ut = roof.ringU[j] - drop;
      E.push(ve);
      N.push(vn);
      UB.push(ub);
      UT.push(ut);
      if (ve < e0) e0 = ve;
      if (ve > e1) e1 = ve;
      if (vn < n0) n0 = vn;
      if (vn > n1) n1 = vn;
      if (ub < u0) u0 = ub;
      if (ut > u1) u1 = ut;
    }
    // Walls: every one of them, front and back; which are drawn is the picture pass's business.
    for (let j = 0; j < len; j++) {
      const k = (j + 1) % len;
      let nx = (roof.ringN[k] - roof.ringN[j]) * wind;
      let ny = -(roof.ringE[k] - roof.ringE[j]) * wind;
      const nl = Math.hypot(nx, ny);
      if (!(nl > 1e-9) || roof.ringU[j] <= uBase0) {
        WNX.push(0);
        WNY.push(0);
        WBE.push(0);
        WOK.push(0);
        continue;
      }
      nx /= nl;
      ny /= nl;
      WNX.push(nx);
      WNY.push(ny);
      WBE.push(Math.atan2(nx, ny) * R2D);
      WOK.push(1);
    }
    for (const face of roof.faces) {
      const m = face.length / 3;
      if (m < 3) continue;
      const v0 = FE.length;
      let bad = false;
      for (let j = 0; j < m; j++) {
        const ve = face[j * 3];
        const vn = face[j * 3 + 1];
        const vu = face[j * 3 + 2] - curvatureDropM(Math.hypot(ve, vn));
        if (!Number.isFinite(ve) || !Number.isFinite(vn) || !Number.isFinite(vu)) {
          bad = true;
          break;
        }
        FE.push(ve);
        FN.push(vn);
        FU.push(vu);
      }
      if (bad) {
        FE.length = v0;
        FN.length = v0;
        FU.length = v0;
        continue;
      }
      // Newell normal, forced upward, so the plane matches the vertices actually drawn.
      let nx = 0;
      let ny = 0;
      let nz = 0;
      let me = 0;
      let mn = 0;
      let mu = 0;
      for (let j = 0, k = m - 1; j < m; k = j++) {
        const ae = FE[v0 + k];
        const an = FN[v0 + k];
        const au = FU[v0 + k];
        const be = FE[v0 + j];
        const bn = FN[v0 + j];
        const bu = FU[v0 + j];
        nx += (an - bn) * (au + bu);
        ny += (au - bu) * (ae + be);
        nz += (ae - be) * (an + bn);
        me += be;
        mn += bn;
        mu += bu;
      }
      const nl = Math.hypot(nx, ny, nz);
      const s = (nz >= 0 ? 1 : -1) / nl;
      const pc = ((nx * me + ny * mn + nz * mu) * s) / m;
      if (!(nl > 1e-12)) {
        FE.length = v0;
        FN.length = v0;
        FU.length = v0;
        continue;
      }
      nx *= s;
      ny *= s;
      nz *= s;
      faceVert.push(FE.length);
      FNX.push(nx);
      FNY.push(ny);
      FNZ.push(nz);
      FPC.push(pc);
      FBE.push(Math.atan2(nx, ny) * R2D);
      FHO.push(Math.hypot(nx, ny));
      for (let j = v0; j < FE.length; j++) {
        if (FE[j] < e0) e0 = FE[j];
        if (FE[j] > e1) e1 = FE[j];
        if (FN[j] < n0) n0 = FN[j];
        if (FN[j] > n1) n1 = FN[j];
        if (FU[j] < u0) u0 = FU[j];
        if (FU[j] > u1) u1 = FU[j];
      }
    }
    cE[i] = (e0 + e1) / 2;
    cN[i] = (n0 + n1) / 2;
    cU[i] = (u0 + u1) / 2;
    radiusM[i] = Math.hypot(e1 - e0, n1 - n0, u1 - u0) / 2;
    spanM[i] = Math.hypot(e1 - e0, n1 - n0);
    riseM[i] = u1 - u0;
    distM[i] = Math.hypot(...frame.toEn(batch.cLng[i], batch.cLat[i]));
    if (e0 < he0) he0 = e0;
    if (e1 > he1) he1 = e1;
    if (n0 < hn0) hn0 = n0;
    if (n1 > hn1) hn1 = n1;
    if (u0 < hu0) hu0 = u0;
    if (u1 > hu1) hu1 = u1;
  }
  ringStart[nb] = E.length;
  faceStart[nb] = faceVert.length - 1;
  const hull = he0 > he1 ? { e: 0, n: 0, u: 0, r: -1 } : { e: (he0 + he1) / 2, n: (hn0 + hn1) / 2, u: (hu0 + hu1) / 2, r: Math.hypot(he1 - he0, hn1 - hn0, hu1 - hu0) / 2 };
  return {
    count: nb,
    ringStart,
    e: Float32Array.from(E),
    n: Float32Array.from(N),
    uBase: Float32Array.from(UB),
    uTop: Float32Array.from(UT),
    wNx: Float32Array.from(WNX),
    wNy: Float32Array.from(WNY),
    wBear: Float32Array.from(WBE),
    wOk: Uint8Array.from(WOK),
    faceStart,
    faceVert: Int32Array.from(faceVert),
    fE: Float32Array.from(FE),
    fN: Float32Array.from(FN),
    fU: Float32Array.from(FU),
    fNx: Float32Array.from(FNX),
    fNy: Float32Array.from(FNY),
    fNz: Float32Array.from(FNZ),
    fPc: Float32Array.from(FPC),
    fBear: Float32Array.from(FBE),
    fHor: Float32Array.from(FHO),
    cE,
    cN,
    cU,
    radiusM,
    distM,
    spanM,
    riseM,
    hull
  };
}

/**
 * Whether a bounding sphere can touch the frame: against the frame rectangle once the sphere is
 * safely in front of the eye, against the frame's diagonal cone while it still straddles it.
 */
export function sphereVisible(ce: number, cn: number, cu: number, r: number, basis: CameraBasis, f: number, wMm: number, hMm: number, coneDeg: number): boolean {
  const { forward: F, right: R, up: U } = basis;
  const depth = ce * F.x + cn * F.y + cu * F.z;
  if (depth + r <= NEAR_M) return false;
  if (depth > r + NEAR_M) {
    const rm = (r / depth) * f;
    return Math.abs(((ce * R.x + cn * R.y + cu * R.z) / depth) * f) - rm <= wMm / 2 && Math.abs(((ce * U.x + cn * U.y + cu * U.z) / depth) * f) - rm <= hMm / 2;
  }
  const l = Math.sqrt(ce * ce + cn * cn + cu * cu);
  if (l < 1e-6) return false;
  return Math.acos(Math.min(1, Math.max(-1, depth / l))) * R2D - Math.asin(Math.min(1, r / l)) * R2D <= coneDeg;
}

