/**
 * Conservative height bounds per quadtree block, from a coarse DEM prepass. `selectBlocks` needs to
 * know where a block sits vertically before any of the mesh's own heights have been fetched, and it
 * asks thousands of times across its reach bisection, so this is a pyramid of max/min grids aligned
 * to the block quadtree: one O(1) lookup per block, built once per mesh request.
 */

import type { LngLat } from '@core/geo/geodesy';
import { lngLatToTilePixel, metersPerPixel, tileKey, type TileCoord } from '@core/terrain/tiles';
import { elevationAt, type DemSource, type DemTile } from './dem';
import { BLOCKS_PER_SIDE, BASE_CELL_M, blockSideM, blockUnitBounds, frameWedgeHalfDeg, samplePoint, type BlockId, type MeshView } from './mesh';

/**
 * Vertical slack for the relief the coarse posts step over: a 2:1 slope across the worst-case gap
 * between them, which covers Alpine cliffs. Under-stating a block's maximum is the one dangerous
 * direction — it would coarsen ground the picture actually shows.
 */
export const RELIEF_PAD_POSTS = 1.5;

/**
 * Level the pyramid's grid starts at: the one whose cell is 2 m. A finer mesh floor would otherwise
 * make the grid 4x denser per rung; blocks below it read their covering ancestor, looser, never unsafe.
 */
export const BOUND_BASE_LEVEL = Math.max(0, Math.round(Math.log2(2 / BASE_CELL_M)));

/** A block whose footprint had no coverage at all, so it can never be coarsened away. */
const UNBOUNDED = { minM: -Infinity, maxM: Infinity };

export type HeightBound = (b: BlockId) => { minM: number; maxM: number };

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** The neighbouring float32 away from (`dir` 1) or towards (-1) zero. */
function step32(f: number, dir: 1 | -1): number {
  f32[0] = f;
  if (f === 0) u32[0] = dir > 0 ? 1 : 0x8000_0001;
  else u32[0] += (f > 0) === (dir > 0) ? 1 : -1;
  return f32[0];
}

/**
 * `v` as a float32 at or beyond it in direction `dir`. Storing the pyramid as float32 rounds to
 * nearest, which would pull a bound inwards half the time; a nudge outwards keeps it conservative.
 */
function out32(v: number, dir: 1 | -1): number {
  const f = Math.fround(v);
  if (!Number.isFinite(f) || (dir > 0 ? f >= v : f <= v)) return f;
  return step32(f, dir);
}

interface Pyramid {
  maxAt: Float32Array[];
  minAt: Float32Array[];
  padM: number;
  /** False when some post had no coverage; such a grid can still improve, so it must not be reused. */
  complete: boolean;
}

interface Memo extends Pyramid {
  src: DemSource;
  lng: number;
  lat: number;
  zoom: number;
  postM: number;
  rootLevel: number;
}

/**
 * Most recent pyramid. It depends only on the pin and the DEM, never on the view, so every rebuild
 * driven by aim, focal length or tilt would recompute a bit-identical megabyte grid. One entry is
 * enough: the pin rarely moves and each entry is ~11 MB.
 */
let memo: Memo | null = null;

/**
 * Bounds for every block inside the root square of `rootLevel`, sampled from `src` at `zoom` whose
 * posts are `postM` apart. Each block's span is taken over its own post footprint dilated by one
 * post and then padded vertically, so a sample that lands just outside the block cannot hide a
 * ridge on its rim.
 */
export function buildHeightBound(pin: LngLat, src: DemSource, zoom: number, postM: number, rootLevel: number): HeightBound {
  let p: Pyramid;
  if (memo && memo.src === src && memo.lng === pin.lng && memo.lat === pin.lat && memo.zoom === zoom && memo.postM === postM && memo.rootLevel === rootLevel) {
    p = memo;
  } else {
    p = buildPyramid(pin, src, zoom, postM, rootLevel);
    memo = p.complete ? { ...p, src, lng: pin.lng, lat: pin.lat, zoom, postM, rootLevel } : null;
  }

  const { maxAt, minAt, padM } = p;
  const base = Math.min(BOUND_BASE_LEVEL, rootLevel);
  return (b) => {
    if (b.level < 0 || b.level > rootLevel) return UNBOUNDED;
    const up = Math.max(0, base - b.level);
    const level = b.level + up;
    const d = BLOCKS_PER_SIDE * 2 ** (rootLevel - level);
    const x = Math.floor(b.ix / 2 ** up) + d / 2;
    const y = Math.floor(b.iy / 2 ** up) + d / 2;
    if (x < 0 || y < 0 || x >= d || y >= d) return UNBOUNDED;
    const i = y * d + x;
    return { minM: minAt[level - base][i] - padM, maxM: maxAt[level - base][i] + padM };
  };
}

function buildPyramid(pin: LngLat, src: DemSource, zoom: number, postM: number, rootLevel: number): Pyramid {
  const base = Math.min(BOUND_BASE_LEVEL, rootLevel);
  const halfBlocks = (BLOCKS_PER_SIDE / 2) * 2 ** (rootLevel - base);
  const per = Math.max(1, Math.ceil(blockSideM(base) / postM));
  const stepM = blockSideM(base) / per;
  const ns = 2 * halfBlocks * per + 3;
  const padM = RELIEF_PAD_POSTS * postM;
  const h = new Float64Array(ns * ns);
  let complete = true;
  for (let j = 0; j < ns; j++) {
    const n = (j - halfBlocks * per - 1) * stepM;
    for (let i = 0; i < ns; i++) {
      const p = samplePoint(pin, (i - halfBlocks * per - 1) * stepM, n);
      const v = elevationAt(src, p.lng, p.lat, zoom);
      // Terrarium reads water as bathymetry, and the mesh clamps it to the datum.
      if (Number.isNaN(v)) complete = false;
      h[j * ns + i] = Number.isNaN(v) ? NaN : Math.max(v, 0);
    }
  }

  // The pad is added at lookup rather than baked in, so the stored value stays the raw height.
  const maxAt: Float32Array[] = [];
  const minAt: Float32Array[] = [];
  let side = 2 * halfBlocks;
  const mx = new Float32Array(side * side);
  const mn = new Float32Array(side * side);
  for (let cy = 0; cy < side; cy++)
    for (let cx = 0; cx < side; cx++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = cy * per; j <= cy * per + per + 2; j++)
        for (let i = cx * per; i <= cx * per + per + 2; i++) {
          const v = h[j * ns + i];
          if (Number.isNaN(v)) {
            lo = -Infinity;
            hi = Infinity;
          }
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      mx[cy * side + cx] = out32(hi, 1);
      mn[cy * side + cx] = out32(lo, -1);
    }
  maxAt.push(mx);
  minAt.push(mn);
  for (let l = base + 1; l <= rootLevel; l++) {
    const wide = side;
    side /= 2;
    const pmx = maxAt[l - 1 - base];
    const pmn = minAt[l - 1 - base];
    const nmx = new Float32Array(side * side);
    const nmn = new Float32Array(side * side);
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++) {
        const a = 2 * y * wide + 2 * x;
        nmx[y * side + x] = Math.max(pmx[a], pmx[a + 1], pmx[a + wide], pmx[a + wide + 1]);
        nmn[y * side + x] = Math.min(pmn[a], pmn[a + 1], pmn[a + wide], pmn[a + wide + 1]);
      }
    maxAt.push(nmx);
    minAt.push(nmn);
  }

  return { maxAt, minAt, padM, complete };
}

/** Most mip texels a block reads across each axis of a tile; coarser mips loosen the bound enough to cost a cell size. */
const DETAIL_MIP_SPAN = 64;

/** Max and min of one tile's posts over 2^k-post squares, finest first. */
interface TileMips {
  size: number;
  max: Float32Array[];
  min: Float32Array[];
}

// Held per tile, not per view: a pan re-cuts the mesh over the same tiles.
const mipsByTile = new WeakMap<DemTile, TileMips>();

function tileMips(t: DemTile): TileMips {
  let m = mipsByTile.get(t);
  if (!m) mipsByTile.set(t, (m = buildTileMips(t)));
  return m;
}

function buildTileMips(t: DemTile): TileMips {
  // The mesh clamps water to the datum, so the bound does too.
  const base = t.elev.map((v) => Math.max(v, 0));
  const max = [base];
  const min = [base];
  for (let s = t.size; s > 1; ) {
    const ps = s;
    s = Math.ceil(s / 2);
    const pmx = max[max.length - 1];
    const pmn = min[min.length - 1];
    const mx = new Float32Array(s * s);
    const mn = new Float32Array(s * s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const x1 = Math.min(2 * x + 1, ps - 1);
        const y1 = Math.min(2 * y + 1, ps - 1);
        const a = 2 * y * ps;
        const b = y1 * ps;
        mx[y * s + x] = Math.max(pmx[a + 2 * x], pmx[a + x1], pmx[b + 2 * x], pmx[b + x1]);
        mn[y * s + x] = Math.min(pmn[a + 2 * x], pmn[a + x1], pmn[b + 2 * x], pmn[b + x1]);
      }
    max.push(mx);
    min.push(mn);
  }
  return { size: t.size, max, min };
}

/**
 * Tighter bounds where finer tiles are loaded: the extremes of every post under a block, read from
 * each tile's max/min mips, padded by `RELIEF_PAD_POSTS` of that zoom. Null where a tile is missing,
 * so the caller keeps the coarse bound there. Built per view, so it only covers what the view asks for.
 */
export function buildDetailBound(pin: LngLat, src: DemSource, zoom: number, postM: number): (b: BlockId) => { minM: number; maxM: number } | null {
  const mips = new Map<string, TileMips | null>();
  const mipsOf = (x: number, y: number): TileMips | null => {
    const k = `${x}/${y}`;
    let m = mips.get(k);
    if (m === undefined) {
      const t = src.get(zoom, x, y);
      m = t ? tileMips(t) : null;
      mips.set(k, m);
    }
    return m;
  };
  const n = 2 ** zoom;
  const padM = RELIEF_PAD_POSTS * postM;
  const seen = new Map<string, { minM: number; maxM: number } | null>();
  return (b) => {
    const key = `${b.level}/${b.ix}/${b.iy}`;
    let r = seen.get(key);
    if (r === undefined) seen.set(key, (r = detailAt(b)));
    return r;
  };
  function detailAt(b: BlockId): { minM: number; maxM: number } | null {
    const u = blockUnitBounds(pin, b, postM);
    let lo = Infinity;
    let hi = -Infinity;
    for (let ty = Math.floor(u.y0 * n); ty <= Math.floor(u.y1 * n); ty++)
      for (let tx = Math.floor(u.x0 * n); tx <= Math.floor(u.x1 * n); tx++) {
        const m = mipsOf(((tx % n) + n) % n, ty);
        if (!m) return null;
        const s = m.size;
        // Posts sit at pixel centres: take every post whose bilinear cell touches the footprint.
        const x0 = Math.max(0, Math.floor((u.x0 * n - tx) * s - 0.5));
        const x1 = Math.min(s - 1, Math.ceil((u.x1 * n - tx) * s - 0.5));
        const y0 = Math.max(0, Math.floor((u.y0 * n - ty) * s - 0.5));
        const y1 = Math.min(s - 1, Math.ceil((u.y1 * n - ty) * s - 0.5));
        let k = 0;
        while ((x1 >> k) - (x0 >> k) >= DETAIL_MIP_SPAN || (y1 >> k) - (y0 >> k) >= DETAIL_MIP_SPAN) k++;
        const w = Math.ceil(s / 2 ** k);
        const mx = m.max[k];
        const mn = m.min[k];
        for (let y = y0 >> k; y <= y1 >> k; y++)
          for (let x = x0 >> k; x <= x1 >> k; x++) {
            if (mx[y * w + x] > hi) hi = mx[y * w + x];
            if (mn[y * w + x] < lo) lo = mn[y * w + x];
          }
      }
    return { minM: lo - padM, maxM: hi + padM };
  }
}

/** How far out the detail bound reaches; past it the coarse pad is already small beside any frame's own pad. */
export const DETAIL_RANGE_M = 16_000;
/** Most tiles the detail bound may wait for, the same as the coarse prepass. */
export const DETAIL_MAX_TILES = 16;

/**
 * Coverage for the detail bound: the finest zoom in [minZoom, maxZoom] whose tiles over the frame's
 * widest wedge still number at most `DETAIL_MAX_TILES`. Sampled at a third of a tile so the sector,
 * not its bounding box, is paid for; a tile it misses only leaves the coarse bound in place.
 */
export function planDetailBound(pin: LngLat, view: MeshView, rangeM: number, minZoom: number, maxZoom: number, tileSize: number): { zoom: number; tiles: TileCoord[] } | null {
  const halfDeg = Math.min(180, frameWedgeHalfDeg(view));
  const reachM = Math.min(rangeM, DETAIL_RANGE_M);
  for (let z = maxZoom; z >= minZoom; z--) {
    const stepM = (metersPerPixel(pin.lat, z, tileSize) * tileSize) / 3;
    const tiles = new Map<string, TileCoord>();
    for (let r = stepM / 2; r < reachM + stepM && tiles.size <= DETAIL_MAX_TILES; r += stepM) {
      const n = Math.max(2, Math.ceil((2 * halfDeg * (Math.PI / 180) * r) / stepM));
      for (let i = 0; i <= n; i++) {
        const az = ((view.azimuthDeg - halfDeg + (2 * halfDeg * i) / n) * Math.PI) / 180;
        const p = samplePoint(pin, Math.min(r, reachM) * Math.sin(az), Math.min(r, reachM) * Math.cos(az));
        const t = lngLatToTilePixel(p.lng, p.lat, z);
        tiles.set(tileKey(z, t.x, t.y), { z, x: t.x, y: t.y });
      }
    }
    if (tiles.size <= DETAIL_MAX_TILES) return { zoom: z, tiles: [...tiles.values()] };
  }
  return null;
}
