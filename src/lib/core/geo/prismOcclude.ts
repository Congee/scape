/**
 * Per-object building occlusion. The GPU draws the buildings under the 2D overlay, so a star or a
 * disc behind a tower has to be dropped one object at a time rather than painted over afterwards.
 */

import type { PrismTile } from './prismRaster';

const R2D = 180 / Math.PI;
/** One bucket per degree of azimuth; a query touches one of them. */
const BUCKETS = 360;

interface Entry {
  tile: PrismTile;
  /** Building index within the tile. */
  i: number;
  uMin: number;
  uMax: number;
}

/** Scratch for the crossings of one footprint; a ring is never anywhere near this long. */
let ts = new Float64Array(64);

/**
 * True when the horizontal ray `(dx, dy)` enters the footprint and the prism's height band covers
 * the ray there. The eye is the origin, so the ray parameter is also the 3D one.
 */
function hitsPrism(tile: PrismTile, i: number, uMin: number, uMax: number, dx: number, dy: number, dz: number, maxT: number): boolean {
  const s0 = tile.ringStart[i];
  const len = tile.ringStart[i + 1] - s0;
  if (len < 3) return false;
  if (ts.length < len) ts = new Float64Array(len * 2);
  const useX = Math.abs(dx) >= Math.abs(dy);
  let k = 0;
  for (let j = 0; j < len; j++) {
    const a = s0 + j;
    const b = s0 + ((j + 1) % len);
    const e1 = tile.e[a];
    const n1 = tile.n[a];
    const eE = tile.e[b] - e1;
    const eN = tile.n[b] - n1;
    const den = eE * dy - eN * dx;
    if (den === 0) continue;
    // Half open, so a ray through a vertex crosses once and the even-odd parity holds.
    const s = (n1 * dx - e1 * dy) / den;
    if (s < 0 || s >= 1) continue;
    const t = useX ? (e1 + s * eE) / dx : (n1 + s * eN) / dy;
    if (t > 0) ts[k++] = t;
  }
  if (k < 1) return false;
  for (let a = 1; a < k; a++) {
    const v = ts[a];
    let b = a - 1;
    while (b >= 0 && ts[b] > v) {
      ts[b + 1] = ts[b];
      b--;
    }
    ts[b + 1] = v;
  }
  // Beyond the last crossing the ray is outside, so inside spans pair off from the end;
  // an odd count leaves the eye itself inside the footprint, out to the first crossing.
  const spans = (t0: number, t1: number) => {
    if (t0 >= maxT) return false;
    const u0 = t0 * dz;
    const u1 = Math.min(t1, maxT) * dz;
    return Math.max(u0, u1) >= uMin && Math.min(u0, u1) <= uMax;
  };
  for (let a = k - 1; a > 0; a -= 2) if (spans(ts[a - 1], ts[a])) return true;
  return k % 2 === 1 && spans(0, ts[0]);
}

/**
 * Buildings bucketed by azimuth, so one direction costs a bucket lookup and a handful of tests.
 * Prisms are eye-relative and immobile, so an index outlives every pan and zoom.
 */
export class PrismOccluder {
  private readonly buckets: Entry[][] = Array.from({ length: BUCKETS }, () => []);

  constructor(tiles: Iterable<PrismTile>, rangeM: number) {
    for (const tile of tiles) {
      for (let i = 0; i < tile.count; i++) {
        if (tile.ringStart[i + 1] - tile.ringStart[i] < 3) continue;
        if (Math.max(1, tile.distM[i]) > rangeM) continue;
        const ce = tile.cE[i];
        const cn = tile.cN[i];
        const l = Math.hypot(ce, cn);
        if (l < 1e-6) continue;
        let uMin = Infinity;
        let uMax = -Infinity;
        for (let v = tile.ringStart[i]; v < tile.ringStart[i + 1]; v++) {
          if (tile.uBase[v] < uMin) uMin = tile.uBase[v];
          if (tile.uTop[v] > uMax) uMax = tile.uTop[v];
        }
        for (let q = tile.faceVert[tile.faceStart[i]]; q < tile.faceVert[tile.faceStart[i + 1]]; q++) {
          if (tile.fU[q] < uMin) uMin = tile.fU[q];
          if (tile.fU[q] > uMax) uMax = tile.fU[q];
        }
        if (!(uMax >= uMin)) continue;
        const entry: Entry = { tile, i, uMin, uMax };
        const centre = Math.atan2(ce, cn) * R2D;
        const r = tile.radiusM[i];
        // Horizontal half-width of the bounding sphere, widened a bucket so an edge lands inside;
        // a sphere the eye stands in has no bearing at all and goes everywhere.
        const half = r >= l ? 180 : Math.asin(r / l) * R2D + 1;
        const lo = Math.floor(centre - half);
        const hi = Math.min(Math.ceil(centre + half), lo + BUCKETS - 1);
        for (let b = lo; b <= hi; b++) this.buckets[((b % BUCKETS) + BUCKETS) % BUCKETS].push(entry);
      }
    }
  }

  /** True when a building stands between the eye and a point `distM` away along `(e, n, u)`. */
  occludes(e: number, n: number, u: number, distM: number): boolean {
    const len = Math.hypot(e, n, u);
    if (len < 1e-9) return false;
    const dx = e / len;
    const dy = n / len;
    const dz = u / len;
    // Straight up or down: no wall can stand in the way, and the footprint test would divide by zero.
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return false;
    const az = Math.atan2(dx, dy) * R2D;
    const bucket = this.buckets[((Math.floor(az) % BUCKETS) + BUCKETS) % BUCKETS];
    const maxT = Number.isFinite(distM) ? distM : Infinity;
    for (const q of bucket) {
      const { tile, i } = q;
      const ce = tile.cE[i];
      const cn = tile.cN[i];
      const cu = tile.cU[i];
      const t = ce * dx + cn * dy + cu * dz;
      if (t <= 0 || t > maxT) continue;
      const r = tile.radiusM[i];
      if (ce * ce + cn * cn + cu * cu - t * t > r * r) continue;
      if (hitsPrism(tile, i, q.uMin, q.uMax, dx, dy, dz, maxT)) return true;
    }
    return false;
  }
}
