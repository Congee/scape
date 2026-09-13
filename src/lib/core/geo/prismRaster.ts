/** OpenStreetMap footprints extruded to prisms and rasterised with the viewfinder's pinhole camera. */

import type { Camera, CameraBasis } from '@core/optics/projection';
import type { BuildingBatch } from '@workers/buildings.protocol';
import { bearingDeg, curvatureDropM, distanceM, type LngLat } from './geodesy';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
/** Faces are clipped in front of this depth along the optical axis, so nothing beside or behind the eye projects. */
const NEAR_M = 0.5;
/** Smallest projected extent worth a face, pixels. */
const MIN_PX = 0.75;
/** Far-first level of detail: below this projected area a building is a speck, not a volume. */
const MIN_AREA_PX = 3;
const BASE_R = 0xf4;
const BASE_G = 0xf4;
const BASE_B = 0xf6;
const ROOF_SHADE = 0.92;
/** Same haze falloff the terrain's ground colour uses. */
const HAZE_M = 45_000;

/** One tile's prisms in eye-relative metres: east, north, and up with the curvature drop already removed. */
export interface PrismTile {
  count: number;
  /** Outer-ring vertex range of building i is [ringStart[i], ringStart[i + 1]); the ring is not closed. */
  ringStart: Int32Array;
  e: Float32Array;
  n: Float32Array;
  uBase: Float32Array;
  uTop: Float32Array;
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
  /** +1 where the ring winds counter-clockwise, -1 clockwise; orients the wall normals. */
  wind: Int8Array;
  /** Bounding sphere of the whole tile, so a tile outside the frame costs one test. */
  hull: { e: number; n: number; u: number; r: number };
}

export interface PrismTarget {
  rw: number;
  rh: number;
  /** Ground distance in metres, +Infinity where no face was drawn. */
  depth: Float32Array;
  /** Shaded colour as 0xRRGGBB; only meaningful where `depth` is finite. */
  color: Uint32Array;
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

export function makePrismTarget(rw: number, rh: number): PrismTarget {
  return { rw, rh, depth: new Float32Array(rw * rh), color: new Uint32Array(rw * rh) };
}

/**
 * Eye-relative prisms for one tile. A vertex lands where `elevationAngleDeg(d, dz)` puts it, so it
 * lines up with the terrain sweep and the target; recompute only when the camera location moves.
 */
export function buildPrisms(batch: BuildingBatch, pin: LngLat, eyeM: number): PrismTile {
  const nb = batch.count;
  const nv = batch.ringStart[nb];
  const e = new Float32Array(nv);
  const n = new Float32Array(nv);
  const uBase = new Float32Array(nv);
  const uTop = new Float32Array(nv);
  const cE = new Float32Array(nb);
  const cN = new Float32Array(nb);
  const cU = new Float32Array(nb);
  const radiusM = new Float32Array(nb);
  const distM = new Float32Array(nb);
  const spanM = new Float32Array(nb);
  const riseM = new Float32Array(nb);
  const wind = new Int8Array(nb);
  let he0 = Infinity;
  let he1 = -Infinity;
  let hn0 = Infinity;
  let hn1 = -Infinity;
  let hu0 = Infinity;
  let hu1 = -Infinity;
  for (let i = 0; i < nb; i++) {
    const g = batch.groundM[i];
    // No DEM tile: sea level, which is where most of these footprints sit anyway.
    const ground = Number.isNaN(g) ? 0 : Math.max(g, 0);
    const base = ground + batch.minHeightM[i] - eyeM;
    const top = ground + batch.heightM[i] - eyeM;
    let e0 = Infinity;
    let e1 = -Infinity;
    let n0 = Infinity;
    let n1 = -Infinity;
    let u0 = Infinity;
    let u1 = -Infinity;
    for (let j = batch.ringStart[i]; j < batch.ringStart[i + 1]; j++) {
      const p = { lng: batch.lng[j], lat: batch.lat[j] };
      const d = distanceM(pin, p);
      const az = bearingDeg(pin, p) * D2R;
      const drop = curvatureDropM(d);
      const ve = d * Math.sin(az);
      const vn = d * Math.cos(az);
      e[j] = ve;
      n[j] = vn;
      uBase[j] = base - drop;
      uTop[j] = top - drop;
      if (ve < e0) e0 = ve;
      if (ve > e1) e1 = ve;
      if (vn < n0) n0 = vn;
      if (vn > n1) n1 = vn;
      if (uBase[j] < u0) u0 = uBase[j];
      if (uTop[j] > u1) u1 = uTop[j];
    }
    if (e0 > e1) continue;
    let area = 0;
    for (let j = batch.ringStart[i]; j < batch.ringStart[i + 1]; j++) {
      const q = j + 1 < batch.ringStart[i + 1] ? j + 1 : batch.ringStart[i];
      area += e[j] * n[q] - e[q] * n[j];
    }
    wind[i] = area >= 0 ? 1 : -1;
    cE[i] = (e0 + e1) / 2;
    cN[i] = (n0 + n1) / 2;
    cU[i] = (u0 + u1) / 2;
    radiusM[i] = Math.hypot(e1 - e0, n1 - n0, u1 - u0) / 2;
    spanM[i] = Math.hypot(e1 - e0, n1 - n0);
    riseM[i] = u1 - u0;
    distM[i] = distanceM(pin, { lng: batch.cLng[i], lat: batch.cLat[i] });
    if (e0 < he0) he0 = e0;
    if (e1 > he1) he1 = e1;
    if (n0 < hn0) hn0 = n0;
    if (n1 > hn1) hn1 = n1;
    if (u0 < hu0) hu0 = u0;
    if (u1 > hu1) hu1 = u1;
  }
  const hull = he0 > he1 ? { e: 0, n: 0, u: 0, r: -1 } : { e: (he0 + he1) / 2, n: (hn0 + hn1) / 2, u: (hu0 + hu1) / 2, r: Math.hypot(he1 - he0, hn1 - hn0, hu1 - hu0) / 2 };
  return { count: nb, ringStart: batch.ringStart, e, n, uBase, uTop, cE, cN, cU, radiusM, distM, spanM, riseM, wind, hull };
}

// Scratch for the face being clipped, projected and filled; faces are drawn one at a time.
let cap = 0;
let fe = new Float64Array(0);
let fn = new Float64Array(0);
let fu = new Float64Array(0);
let ge = new Float64Array(0);
let gn = new Float64Array(0);
let gu = new Float64Array(0);
let sx = new Float64Array(0);
let sy = new Float64Array(0);
let xs = new Float64Array(0);

function ensureCap(want: number) {
  if (want <= cap) return;
  cap = Math.max(64, want * 2);
  fe = new Float64Array(cap);
  fn = new Float64Array(cap);
  fu = new Float64Array(cap);
  ge = new Float64Array(cap);
  gn = new Float64Array(cap);
  gu = new Float64Array(cap);
  sx = new Float64Array(cap);
  sy = new Float64Array(cap);
  xs = new Float64Array(cap);
}

/** Sutherland-Hodgman clip of the face in `f*` against depth > NEAR_M, result in `g*`; returns its vertex count. */
function clipNear(m: number, F: { x: number; y: number; z: number }): number {
  let out = 0;
  for (let i = 0, j = m - 1; i < m; j = i++) {
    const di = fe[i] * F.x + fn[i] * F.y + fu[i] * F.z - NEAR_M;
    const dj = fe[j] * F.x + fn[j] * F.y + fu[j] * F.z - NEAR_M;
    if (di >= 0 !== dj >= 0) {
      const t = dj / (dj - di);
      ge[out] = fe[j] + t * (fe[i] - fe[j]);
      gn[out] = fn[j] + t * (fn[i] - fn[j]);
      gu[out] = fu[j] + t * (fu[i] - fu[j]);
      out++;
    }
    if (di >= 0) {
      ge[out] = fe[i];
      gn[out] = fn[i];
      gu[out] = fu[i];
      out++;
    }
  }
  return out;
}

/**
 * Even-odd scanline fill of one clipped face, with the depth of each pixel taken from the
 * ray-plane intersection (`nx,ny,nz` is the plane normal, `pc` its constant: N·P = pc).
 */
function fillFace(t: PrismTarget, m: number, nx: number, ny: number, nz: number, pc: number, color: number, basis: CameraBasis, f: number, wMm: number, hMm: number) {
  const { rw, rh, depth, color: buf } = t;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < m; i++) {
    if (sy[i] < minY) minY = sy[i];
    if (sy[i] > maxY) maxY = sy[i];
  }
  const y0 = Math.max(0, Math.ceil(minY));
  const y1 = Math.min(rh - 1, Math.floor(maxY));
  if (y0 > y1) return;
  const { forward: F, right: R, up: U } = basis;
  for (let py = y0; py <= y1; py++) {
    let k = 0;
    for (let i = 0, j = m - 1; i < m; j = i++) {
      const yi = sy[i];
      const yj = sy[j];
      if (yi <= py === yj <= py) continue;
      xs[k++] = sx[i] + ((py - yi) / (yj - yi)) * (sx[j] - sx[i]);
    }
    if (k < 2) continue;
    for (let i = 1; i < k; i++) {
      const v = xs[i];
      let j = i - 1;
      while (j >= 0 && xs[j] > v) {
        xs[j + 1] = xs[j];
        j--;
      }
      xs[j + 1] = v;
    }
    const bMm = ((0.5 - (py + 0.5) / rh) * hMm) / f;
    const bx = F.x + bMm * U.x;
    const by = F.y + bMm * U.y;
    const bz = F.z + bMm * U.z;
    for (let s = 0; s + 1 < k; s += 2) {
      const xa = Math.max(0, Math.ceil(xs[s]));
      const xb = Math.min(rw - 1, Math.floor(xs[s + 1]));
      for (let px = xa; px <= xb; px++) {
        const aMm = (((px + 0.5) / rw - 0.5) * wMm) / f;
        const dx = bx + aMm * R.x;
        const dy = by + aMm * R.y;
        const dz = bz + aMm * R.z;
        const den = nx * dx + ny * dy + nz * dz;
        if (den === 0) continue;
        const ray = pc / den;
        if (!(ray > 0)) continue;
        const gd = ray * Math.sqrt(dx * dx + dy * dy);
        const idx = py * rw + px;
        if (gd < depth[idx]) {
          depth[idx] = gd;
          buf[idx] = color;
        }
      }
    }
  }
}

const q8 = (v: number) => Math.min(255, Math.max(0, v)) | 0;

/** Base colour times a flat shade, hazed toward the far ground and dimmed at night, as 0xRRGGBB. */
function shadeColor(k: number, clear: number, sh: PrismShading): number {
  const dim = k * clear * (1 - 0.45 * sh.night);
  const haze = 1 - clear;
  return (q8(BASE_R * dim + sh.hazeRgb[0] * haze) << 16) | (q8(BASE_G * dim + sh.hazeRgb[1] * haze) << 8) | q8(BASE_B * dim + sh.hazeRgb[2] * haze);
}

/** Projects the clipped face in `g*` into `sx`/`sy`; pixel centres sit on integer coordinates. */
function projectFace(m: number, basis: CameraBasis, f: number, rw: number, rh: number, wMm: number, hMm: number) {
  const { forward: F, right: R, up: U } = basis;
  const kx = rw / wMm;
  const ky = rh / hMm;
  for (let i = 0; i < m; i++) {
    const pe = ge[i];
    const pn = gn[i];
    const pu = gu[i];
    const d = pe * F.x + pn * F.y + pu * F.z;
    const xMm = ((pe * R.x + pn * R.y + pu * R.z) / d) * f;
    const yMm = ((pe * U.x + pn * U.y + pu * U.z) / d) * f;
    sx[i] = xMm * kx + rw / 2 - 0.5;
    sy[i] = rh / 2 - 0.5 - yMm * ky;
  }
}

/**
 * Whether a bounding sphere can touch the frame: against the frame rectangle once the sphere is
 * safely in front of the eye, against the frame's diagonal cone while it still straddles it.
 */
function sphereVisible(ce: number, cn: number, cu: number, r: number, basis: CameraBasis, f: number, wMm: number, hMm: number, coneDeg: number): boolean {
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

/**
 * Draws every visible prism into `t`, nearest face per pixel. Buildings outside the frame's cone,
 * past the range or smaller than a pixel are dropped; the result is depth-tested against the
 * terrain sweep by the caller.
 */
export function rasterisePrisms(t: PrismTarget, cam: Camera, basis: CameraBasis, tiles: Iterable<PrismTile>, sh: PrismShading): number {
  t.depth.fill(Infinity);
  const { forward: F } = basis;
  const f = cam.focalMm;
  const wMm = cam.frameWmm;
  const hMm = cam.frameHmm;
  const { rw, rh } = t;
  const coneDeg = Math.atan(Math.hypot(wMm, hMm) / 2 / f) * R2D;
  // Raster pixels spanned by a metre at one metre; divided by distance it gives a projected size.
  const pxPerMAt1 = (f * rw) / wMm;
  let drawn = 0;
  for (const tile of tiles) {
    const h = tile.hull;
    if (h.r < 0 || !sphereVisible(h.e, h.n, h.u, h.r, basis, f, wMm, hMm, coneDeg)) continue;
    for (let i = 0; i < tile.count; i++) {
      const s = tile.ringStart[i];
      const len = tile.ringStart[i + 1] - s;
      if (len < 3) continue;
      // A metre floor keeps a footprint the eye stands inside out of the divisions below.
      const dist = Math.max(1, tile.distM[i]);
      if (dist > sh.rangeM) continue;
      // Size first: it is pure arithmetic and drops most of a dense tile before any trigonometry.
      const k = pxPerMAt1 / dist;
      const wPx = tile.spanM[i] * k;
      const hPx = tile.riseM[i] * k;
      if (wPx < MIN_PX && hPx < MIN_PX) continue;
      if (wPx * hPx < MIN_AREA_PX) continue;
      if (!sphereVisible(tile.cE[i], tile.cN[i], tile.cU[i], tile.radiusM[i], basis, f, wMm, hMm, coneDeg)) continue;
      ensureCap(len * 2 + 8);
      drawn++;
      const clear = Math.exp(-dist / HAZE_M);
      // Roof: the footprint at its top, a horizontal plane, seen only from above it.
      let uMean = 0;
      for (let j = 0; j < len; j++) uMean += tile.uTop[s + j];
      uMean /= len;
      let m = 0;
      if (uMean < 0) {
        for (let j = 0; j < len; j++) {
          fe[j] = tile.e[s + j];
          fn[j] = tile.n[s + j];
          fu[j] = tile.uTop[s + j];
        }
        m = clipNear(len, F);
        if (m >= 3) {
          projectFace(m, basis, f, rw, rh, wMm, hMm);
          fillFace(t, m, 0, 0, 1, uMean, shadeColor(ROOF_SHADE, clear, sh), basis, f, wMm, hMm);
        }
      }
      // Walls: the quad between consecutive vertices, a vertical plane; the floor is never drawn.
      for (let j = 0; j < len; j++) {
        const a = s + j;
        const b = s + ((j + 1) % len);
        if (tile.uTop[a] <= tile.uBase[a]) continue;
        const e1 = tile.e[a];
        const n1 = tile.n[a];
        const e2 = tile.e[b];
        const n2 = tile.n[b];
        let nx = (n2 - n1) * tile.wind[i];
        let ny = -(e2 - e1) * tile.wind[i];
        // Outward normal: a closed prism never shows the inside of a wall, so drop the back faces.
        if (nx * (e1 + e2) + ny * (n1 + n2) >= 0) continue;
        const nl = Math.sqrt(nx * nx + ny * ny);
        if (nl < 1e-9) continue;
        nx /= nl;
        ny /= nl;
        fe[0] = e1;
        fn[0] = n1;
        fu[0] = tile.uBase[a];
        fe[1] = e2;
        fn[1] = n2;
        fu[1] = tile.uBase[b];
        fe[2] = e2;
        fn[2] = n2;
        fu[2] = tile.uTop[b];
        fe[3] = e1;
        fn[3] = n1;
        fu[3] = tile.uTop[a];
        m = clipNear(4, F);
        if (m < 3) continue;
        projectFace(m, basis, f, rw, rh, wMm, hMm);
        const bearing = Math.atan2(nx, ny) * R2D;
        const shade = 0.55 + 0.45 * (0.5 + 0.5 * Math.cos((bearing - sh.lightAzDeg) * D2R));
        fillFace(t, m, nx, ny, 0, nx * e1 + ny * n1, shadeColor(shade, clear, sh), basis, f, wMm, hMm);
      }
    }
  }
  return drawn;
}
