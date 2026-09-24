import { lngLatToTilePixel, tileKey, TILE_SIZE, type TileCoord } from './tiles';

/** One decoded DEM tile: elevations in metres, row-major, NaN where unknown. */
export interface DemTile {
  z: number;
  x: number;
  y: number;
  size: number;
  elev: Float32Array;
  /** Posts the decoder had to refill; diagnostics only. */
  repaired?: number;
}

/**
 * Synchronous tile lookup. `undefined` = not loaded, `null` = known to be missing.
 * Loading happens elsewhere (worker cache); the core stays pure.
 */
export interface DemSource {
  get(z: number, x: number, y: number): DemTile | null | undefined;
}

/** Terrarium carries bathymetry as well as land, so the physical envelope runs Challenger Deep to Everest. */
export const DEM_MIN_M = -11_500;
export const DEM_MAX_M = 9_000;

/**
 * Outlier thresholds. A flagged post must clear both an absolute deviation and a multiple of its
 * neighbourhood's own robust spread: vertical rock deviates far but sits among equally steep posts,
 * while an artifact stands alone in a quiet one.
 */
export const DEM_OUTLIER_MIN_M = 100;
export const DEM_OUTLIER_MADS = 20;
/** Radius of the neighbourhood, so 7x7. A 3x3 is too small: a two-post artifact cluster dominates its own median. */
export const DEM_OUTLIER_RADIUS = 3;
/** Terrarium quantises to about a metre, so a smaller MAD is quantisation noise rather than spread. */
const DEM_OUTLIER_MAD_FLOOR_M = 0.5;

export interface DecodedTerrarium {
  elev: Float32Array;
  /** Posts outside the physical envelope, refilled from a valid neighbour; equals the post count when the tile is unusable. */
  repaired: number;
}

/**
 * Terrarium encoding: (R * 256 + G + B / 256) - 32768 metres. `channels` is the pixel stride (3 RGB, 4 RGBA).
 * Posts outside the physical envelope — source glitches, and the rgb(0,0,0) nodata sentinel at -32768 — are
 * refilled from their nearest valid neighbour rather than clamped, because a clamped pit still rings the cubic.
 * Neighbourhood outliers are refilled from their own neighbourhood median instead.
 */
export function decodeTerrarium(pixels: ArrayLike<number>, size = TILE_SIZE, channels = 4): DecodedTerrarium {
  const elev = new Float32Array(size * size);
  for (let i = 0, p = 0; i < elev.length; i++, p += channels) elev[i] = pixels[p] * 256 + pixels[p + 1] + pixels[p + 2] / 256 - 32768;
  return { elev, repaired: repairPosts(elev, size) };
}

const nbr = new Float64Array((2 * DEM_OUTLIER_RADIUS + 1) ** 2);
const spread = new Float64Array(nbr.length);

/**
 * Flags posts that stand both `DEM_OUTLIER_MIN_M` and `DEM_OUTLIER_MADS` spreads clear of the median of
 * their 7x7 neighbourhood: spikes that are physically plausible but locally impossible, which the envelope
 * test cannot see. Expects posts already inside the envelope, so run it on the output of the range repair,
 * never on a raw decode. `median`, when given, receives the neighbourhood median of each flagged post.
 */
export function findOutlierPosts(elev: Float32Array, size: number, median?: Float32Array): Uint8Array {
  const out = new Uint8Array(elev.length);
  // Below one full neighbourhood there are too few neighbours for a median to mean anything.
  if (size < 2 * DEM_OUTLIER_RADIUS + 1) return out;
  const last = size - 1;
  const r = DEM_OUTLIER_RADIUS;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const v = elev[i];
      // Cheap pre-reject: a post every immediate neighbour hugs is not the isolated spike this looks for,
      // and the 7x7 median is far too costly to take for every post of a tile.
      let near = true;
      for (let dy = y > 0 ? -1 : 0, yb = y < last ? 1 : 0; near && dy <= yb; dy++) {
        const row = i + dy * size;
        for (let dx = x > 0 ? -1 : 0, xb = x < last ? 1 : 0; dx <= xb; dx++)
          if (Math.abs(elev[row + dx] - v) >= DEM_OUTLIER_MIN_M) {
            near = false;
            break;
          }
      }
      if (near) continue;
      let k = 0;
      for (let dy = Math.max(-r, -y), yb = Math.min(r, last - y); dy <= yb; dy++) {
        const row = i + dy * size;
        for (let dx = Math.max(-r, -x), xb = Math.min(r, last - x); dx <= xb; dx++) if (dx || dy) nbr[k++] = elev[row + dx];
      }
      const m = medianOf(nbr, k);
      for (let a = 0; a < k; a++) spread[a] = Math.abs(nbr[a] - m);
      const d = Math.abs(v - m);
      if (d >= DEM_OUTLIER_MIN_M && d >= DEM_OUTLIER_MADS * Math.max(medianOf(spread, k), DEM_OUTLIER_MAD_FLOOR_M)) {
        out[i] = 1;
        if (median) median[i] = m;
      }
    }
  return out;
}

/** Median of the first `k` entries, sorted in place; k is at most 48, so an insertion sort beats a real one. */
function medianOf(a: Float64Array, k: number): number {
  for (let p = 1; p < k; p++) {
    const t = a[p];
    let q = p - 1;
    for (; q >= 0 && a[q] > t; q--) a[q + 1] = a[q];
    a[q + 1] = t;
  }
  return k % 2 ? a[(k - 1) / 2] : (a[k / 2 - 1] + a[k / 2]) / 2;
}

/** Range rejection first, so an out-of-envelope post cannot drag the median the outlier pass tests against. */
function repairPosts(elev: Float32Array, size: number): number {
  const n = elev.length;
  const bad = new Uint8Array(n);
  let repaired = 0;
  for (let i = 0; i < n; i++)
    if (!(elev[i] >= DEM_MIN_M && elev[i] <= DEM_MAX_M)) {
      bad[i] = 1;
      repaired++;
    }
  if (repaired === n) {
    elev.fill(NaN);
    return n;
  }
  // A post outside the envelope can sit where no local value is any good, so that one keeps the BFS fill.
  if (repaired) fillBad(elev, size, bad);
  const median = new Float32Array(n);
  const outliers = findOutlierPosts(elev, size, median);
  let flagged = 0;
  for (let i = 0; i < n; i++) if (outliers[i]) flagged++;
  if (flagged === n) {
    elev.fill(NaN);
    return n;
  }
  for (let i = 0; i < n; i++) if (outliers[i]) elev[i] = median[i];
  return repaired + flagged;
}

/** Multi-source BFS out of the good posts, so every bad post takes the value of a nearest good one. */
function fillBad(elev: Float32Array, size: number, bad: Uint8Array) {
  const n = elev.length;
  const queue = new Int32Array(n);
  let tail = 0;
  for (let i = 0; i < n; i++) if (!bad[i]) queue[tail++] = i;
  let i = 0;
  const fill = (j: number) => {
    if (!bad[j]) return;
    bad[j] = 0;
    elev[j] = elev[i];
    queue[tail++] = j;
  };
  for (let head = 0; head < tail; head++) {
    i = queue[head];
    const x = i % size;
    const y = (i - x) / size;
    if (x > 0) fill(i - 1);
    if (x < size - 1) fill(i + 1);
    if (y > 0) fill(i - size);
    if (y < size - 1) fill(i + size);
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Ancestor of `c` at zoom `z`, which covers the same ground at a coarser resolution. */
export function ancestorTile(c: TileCoord, z: number): TileCoord {
  const d = c.z - z;
  return { z, x: c.x >> d, y: c.y >> d };
}

/** Bilinear sample at fractional pixel coordinates; pixel centres sit at +0.5, edges clamp. */
export function sampleTile(t: DemTile, px: number, py: number): number {
  const s = t.size;
  const fx = clamp(px - 0.5, 0, s - 1);
  const fy = clamp(py - 0.5, 0, s - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, s - 1);
  const y1 = Math.min(y0 + 1, s - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const e = t.elev;
  const top = e[y0 * s + x0] * (1 - tx) + e[y0 * s + x1] * tx;
  const bottom = e[y1 * s + x0] * (1 - tx) + e[y1 * s + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

/**
 * Catmull-Rom through four posts; `t` in [0, 1] runs from p1 to p2, and t = 0 returns p1 exactly.
 * The result is held inside the envelope of its own control posts: unbounded, the spline overshoots a
 * step edge by ~8% of the step, which turns a bad post into a far larger spike. NaN posts still poison it.
 */
const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const v = p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  return Math.min(Math.max(v, Math.min(p0, p1, p2, p3)), Math.max(p0, p1, p2, p3));
};

/**
 * Tile `c` resampled from the sub-rect of an ancestor that covers it, at the ancestor's own
 * post count. Source coverage bottoms out at a different zoom in every region, so a deeper
 * request is answered from the deepest tile that exists rather than left as a hole.
 */
export function overzoomTile(parent: DemTile, c: TileCoord): DemTile {
  const size = parent.size;
  const scale = 2 ** (c.z - parent.z);
  const span = size / scale;
  const ox = (c.x - parent.x * scale) * span;
  const oy = (c.y - parent.y * scale) * span;
  const elev = new Float32Array(size * size);
  for (let py = 0; py < size; py++) {
    const sy = oy + (py + 0.5) / scale;
    for (let px = 0; px < size; px++) elev[py * size + px] = sampleTile(parent, ox + (px + 0.5) / scale, sy);
  }
  return { ...c, size, elev, repaired: parent.repaired };
}

// One stencil touches at most four tiles, and a DemSource's get is not free; resolve each once.
const stencilKey = new Float64Array(4);
const stencilTile: (DemTile | null | undefined)[] = [];

/**
 * Catmull-Rom sample at global pixel coordinates of zoom `z`, over a grid of `size`-pixel tiles.
 * The 4x4 stencil is taken in global pixel space, so it crosses tile borders instead of clamping
 * at them and the reconstructed surface stays C1 there too. It interpolates the posts, so measured
 * elevations survive unchanged. Where a neighbour tile is absent the sample degrades to bilinear,
 * and NaN still means the posts under the point were unavailable.
 */
export function sampleGridCubic(src: DemSource, z: number, size: number, gx: number, gy: number): number {
  const n = 2 ** z;
  const world = size * n;
  const fx = gx - 0.5;
  const fy = gy - 0.5;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  // The common case by far: a 4-post stencil well inside one 256-post tile, read with no bookkeeping.
  const sx = Math.floor((ix - 1) / size);
  const sy = Math.floor((iy - 1) / size);
  if (sx === Math.floor((ix + 2) / size) && sy === Math.floor((iy + 2) / size)) {
    const tile = src.get(z, ((sx % n) + n) % n, sy);
    if (tile) {
      const o = (iy - 1 - sy * size) * size + (ix - 1 - sx * size);
      const e = tile.elev;
      const v = catmullRom(
        catmullRom(e[o], e[o + 1], e[o + 2], e[o + 3], tx),
        catmullRom(e[o + size], e[o + size + 1], e[o + size + 2], e[o + size + 3], tx),
        catmullRom(e[o + 2 * size], e[o + 2 * size + 1], e[o + 2 * size + 2], e[o + 2 * size + 3], tx),
        catmullRom(e[o + 3 * size], e[o + 3 * size + 1], e[o + 3 * size + 2], e[o + 3 * size + 3], tx),
        ty
      );
      if (!Number.isNaN(v)) return v;
    }
  }
  let cached = 0;
  const post = (x: number, y: number): number => {
    const wx = ((x % world) + world) % world;
    const wy = clamp(y, 0, world - 1);
    const cx = Math.floor(wx / size);
    const cy = Math.floor(wy / size);
    const key = cy * n + cx;
    let tile: DemTile | null | undefined;
    let hit = false;
    for (let i = 0; i < cached; i++)
      if (stencilKey[i] === key) {
        tile = stencilTile[i];
        hit = true;
        break;
      }
    if (!hit) {
      tile = src.get(z, cx, cy);
      stencilKey[cached] = key;
      stencilTile[cached] = tile;
      cached++;
    }
    return tile ? tile.elev[(wy - cy * size) * size + (wx - cx * size)] : NaN;
  };
  const row = (j: number): number => {
    const y = iy + j;
    return catmullRom(post(ix - 1, y), post(ix, y), post(ix + 1, y), post(ix + 2, y), tx);
  };
  const v = catmullRom(row(-1), row(0), row(1), row(2), ty);
  if (!Number.isNaN(v)) return v;
  // A stencil that ran past a missing tile falls back to bilinear rather than creasing a seam.
  const p00 = post(ix, iy);
  const p10 = post(ix + 1, iy);
  const p01 = post(ix, iy + 1);
  const p11 = post(ix + 1, iy + 1);
  return (p00 * (1 - tx) + p10 * tx) * (1 - ty) + (p01 * (1 - tx) + p11 * tx) * ty;
}

/** Elevation at a point from tiles of zoom `z`; NaN when the tile is unavailable. */
export function elevationAt(src: DemSource, lng: number, lat: number, z: number): number {
  const t = lngLatToTilePixel(lng, lat, z, 1);
  const tile = src.get(t.z, t.x, t.y);
  return tile ? sampleTile(tile, t.px * tile.size, t.py * tile.size) : NaN;
}

/**
 * Tiles `elevationAtCubic` reads at a point: up to four, since the 4x4 stencil crosses borders.
 * A caller that loads only the containing tile gets a silent bilinear fallback near every edge.
 */
export function cubicStencilTiles(lng: number, lat: number, z: number, size = TILE_SIZE): TileCoord[] {
  const n = 2 ** z;
  const world = size * n;
  const t = lngLatToTilePixel(lng, lat, z, 1);
  const ix = Math.floor((t.x + t.px) * size - 0.5);
  const iy = Math.floor((t.y + t.py) * size - 0.5);
  const col = (x: number) => Math.floor((((x % world) + world) % world) / size);
  const row = (y: number) => Math.floor(clamp(y, 0, world - 1) / size);
  const xs = col(ix - 1) === col(ix + 2) ? [col(ix - 1)] : [col(ix - 1), col(ix + 2)];
  const ys = row(iy - 1) === row(iy + 2) ? [row(iy - 1)] : [row(iy - 1), row(iy + 2)];
  const out: TileCoord[] = [];
  for (const x of xs) for (const y of ys) out.push({ z, x, y });
  return out;
}

/**
 * Elevation at a point with the C1 reconstruction, for surfaces whose shading shows the creases a
 * bilinear one leaves at every post. NaN when the tile the point lands in is unavailable.
 */
export function elevationAtCubic(src: DemSource, lng: number, lat: number, z: number): number {
  const t = lngLatToTilePixel(lng, lat, z, 1);
  const tile = src.get(t.z, t.x, t.y);
  if (!tile) return NaN;
  return sampleGridCubic(src, z, tile.size, (t.x + t.px) * tile.size, (t.y + t.py) * tile.size);
}

/**
 * Sampler for a run of points at one latitude, as a grid row. The tile y and the pixel y depend on
 * the latitude alone, and x usually stays inside the tile the last sample resolved, so a row costs
 * one projection and a handful of tile lookups instead of one of each per cell.
 */
export function demRowAt(src: DemSource, lat: number, z: number): (lng: number) => number {
  const { y, py } = lngLatToTilePixel(0, lat, z, 1);
  const n = 2 ** z;
  let xi = NaN;
  let tile: DemTile | null | undefined;
  return (lng: number) => {
    const xf = ((lng + 180) / 360) * n;
    const fx = Math.floor(xf);
    if (fx !== xi) {
      xi = fx;
      tile = src.get(z, ((fx % n) + n) % n, y);
    }
    return tile ? sampleTile(tile, (xf - fx) * tile.size, py * tile.size) : NaN;
  };
}

/** A shared tile cache: loads, and pins tiles so another request's load cannot evict them mid-read. */
export interface RetainingDemSource extends DemSource {
  retain(coords: readonly TileCoord[]): () => void;
  loadAll(coords: TileCoord[]): Promise<void>;
}

/** Runs `read` once `coords` are loaded, holding them from before the load until it returns. */
export async function withDemTiles<T>(src: RetainingDemSource, coords: TileCoord[], read: () => T): Promise<T> {
  const release = src.retain(coords);
  try {
    await src.loadAll(coords);
    return read();
  } finally {
    release();
  }
}

/** Lowest cubic sample at `points`, metres; null when none of them has data. */
export async function lowestGroundAt(src: RetainingDemSource, points: readonly { lng: number; lat: number }[], z: number, size = TILE_SIZE): Promise<number | null> {
  const need = new Map<string, TileCoord>();
  for (const p of points) for (const t of cubicStencilTiles(p.lng, p.lat, z, size)) need.set(tileKey(t.z, t.x, t.y), t);
  return withDemTiles(src, [...need.values()], () => {
    let low: number | null = null;
    for (const p of points) {
      const g = elevationAtCubic(src, p.lng, p.lat, z);
      if (Number.isFinite(g) && (low === null || g < low)) low = g;
    }
    return low;
  });
}
