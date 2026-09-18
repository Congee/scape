/**
 * Conservative height bounds per quadtree block, from a coarse DEM prepass. `selectBlocks` needs to
 * know where a block sits vertically before any of the mesh's own heights have been fetched, and it
 * asks thousands of times across its reach bisection, so this is a pyramid of max/min grids aligned
 * to the block quadtree: one O(1) lookup per block, built once per mesh request.
 */

import type { LngLat } from '@core/geo/geodesy';
import { elevationAt, type DemSource } from './dem';
import { BLOCKS_PER_SIDE, blockSideM, samplePoint, type BlockId } from './mesh';

/**
 * Vertical slack for the relief the coarse posts step over: a 2:1 slope across the worst-case gap
 * between them, which covers Alpine cliffs. Under-stating a block's maximum is the one dangerous
 * direction — it would coarsen ground the picture actually shows.
 */
export const RELIEF_PAD_POSTS = 1.5;

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
  return (b) => {
    if (b.level < 0 || b.level > rootLevel) return UNBOUNDED;
    const d = BLOCKS_PER_SIDE * 2 ** (rootLevel - b.level);
    const x = b.ix + d / 2;
    const y = b.iy + d / 2;
    if (x < 0 || y < 0 || x >= d || y >= d) return UNBOUNDED;
    const i = y * d + x;
    return { minM: minAt[b.level][i] - padM, maxM: maxAt[b.level][i] + padM };
  };
}

function buildPyramid(pin: LngLat, src: DemSource, zoom: number, postM: number, rootLevel: number): Pyramid {
  const halfBlocks = (BLOCKS_PER_SIDE / 2) * 2 ** rootLevel;
  const per = Math.max(1, Math.ceil(blockSideM(0) / postM));
  const stepM = blockSideM(0) / per;
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
  for (let l = 1; l <= rootLevel; l++) {
    const wide = side;
    side /= 2;
    const pmx = maxAt[l - 1];
    const pmn = minAt[l - 1];
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
