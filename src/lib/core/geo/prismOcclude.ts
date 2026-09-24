/**
 * Per-object building occlusion. The GPU draws the buildings under the 2D overlay, so a star or a
 * disc behind a tower has to be dropped one object at a time rather than painted over afterwards.
 */

import type { PrismTile } from './prismRaster';

const R2D = 180 / Math.PI;
/** One bucket per degree of azimuth; a query touches one of them. */
const BUCKETS = 360;

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
 * One tile's buildings bucketed by azimuth, flat so the worker can build and transfer it: bucket b
 * holds building indices [start[b], start[b + 1]) of `i`; uMin/uMax is each building's height band.
 */
export interface PrismSlots {
  rangeM: number;
  start: Int32Array;
  i: Int32Array;
  uMin: Float32Array;
  uMax: Float32Array;
}

/** Slots per tile, kept so tiles streaming in do not re-index the ones already there. */
const placed = new WeakMap<PrismTile, PrismSlots>();

/** Adopts slots the buildings worker built for `tile`. */
export function adoptPrismSlots(tile: PrismTile, slots: PrismSlots): void {
  placed.set(tile, slots);
}

export function prismSlots(tile: PrismTile, rangeM: number): PrismSlots {
  const uMin = new Float32Array(tile.count);
  const uMax = new Float32Array(tile.count);
  const lo = new Int32Array(tile.count);
  const hi = new Int32Array(tile.count).fill(-1);
  const start = new Int32Array(BUCKETS + 1);
  for (let i = 0; i < tile.count; i++) {
    if (tile.ringStart[i + 1] - tile.ringStart[i] < 3) continue;
    if (Math.max(1, tile.distM[i]) > rangeM) continue;
    const ce = tile.cE[i];
    const cn = tile.cN[i];
    const l = Math.hypot(ce, cn);
    if (l < 1e-6) continue;
    let min = Infinity;
    let max = -Infinity;
    for (let v = tile.ringStart[i]; v < tile.ringStart[i + 1]; v++) {
      if (tile.uBase[v] < min) min = tile.uBase[v];
      if (tile.uTop[v] > max) max = tile.uTop[v];
    }
    for (let q = tile.faceVert[tile.faceStart[i]]; q < tile.faceVert[tile.faceStart[i + 1]]; q++) {
      if (tile.fU[q] < min) min = tile.fU[q];
      if (tile.fU[q] > max) max = tile.fU[q];
    }
    if (!(max >= min)) continue;
    // Exact in float32: both are one of the tile's own float32 values.
    uMin[i] = min;
    uMax[i] = max;
    const centre = Math.atan2(ce, cn) * R2D;
    const r = tile.radiusM[i];
    // Horizontal half-width of the bounding sphere, widened a bucket so an edge lands inside;
    // a sphere the eye stands in has no bearing at all and goes everywhere.
    const half = r >= l ? 180 : Math.asin(r / l) * R2D + 1;
    lo[i] = Math.floor(centre - half);
    hi[i] = Math.min(Math.ceil(centre + half), lo[i] + BUCKETS - 1);
    for (let b = lo[i]; b <= hi[i]; b++) start[(((b % BUCKETS) + BUCKETS) % BUCKETS) + 1]++;
  }
  for (let b = 0; b < BUCKETS; b++) start[b + 1] += start[b];
  const fill = start.slice(0, BUCKETS);
  const idx = new Int32Array(start[BUCKETS]);
  for (let i = 0; i < tile.count; i++) for (let b = lo[i]; b <= hi[i]; b++) idx[fill[((b % BUCKETS) + BUCKETS) % BUCKETS]++] = i;
  return { rangeM, start, i: idx, uMin, uMax };
}

/**
 * Buildings bucketed by azimuth, so one direction costs a bucket lookup per tile and a handful of tests.
 * Prisms are eye-relative and immobile, so an index outlives every pan and zoom.
 */
export class PrismOccluder {
  private readonly tiles: PrismTile[] = [];
  private readonly slots: PrismSlots[] = [];

  constructor(tiles: Iterable<PrismTile>, rangeM: number) {
    for (const tile of tiles) {
      let c = placed.get(tile);
      if (c?.rangeM !== rangeM) placed.set(tile, (c = prismSlots(tile, rangeM)));
      if (c.i.length === 0) continue;
      this.tiles.push(tile);
      this.slots.push(c);
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
    const b = ((Math.floor(az) % BUCKETS) + BUCKETS) % BUCKETS;
    const maxT = Number.isFinite(distM) ? distM : Infinity;
    for (let s = 0; s < this.tiles.length; s++) {
      const tile = this.tiles[s];
      const c = this.slots[s];
      for (let q = c.start[b]; q < c.start[b + 1]; q++) {
        const i = c.i[q];
        const ce = tile.cE[i];
        const cn = tile.cN[i];
        const cu = tile.cU[i];
        const t = ce * dx + cn * dy + cu * dz;
        if (t <= 0 || t > maxT) continue;
        const r = tile.radiusM[i];
        if (ce * ce + cn * cn + cu * cu - t * t > r * r) continue;
        if (hitsPrism(tile, i, c.uMin[i], c.uMax[i], dx, dy, dz, maxT)) return true;
      }
    }
    return false;
  }
}
