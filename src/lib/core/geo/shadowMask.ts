/**
 * Ground shadows for the map, as an 8-bit mask a raster layer draws. A raster composites once, so
 * overlapping shadows cannot compound the way alpha-blended fills do, and MapLibre drapes it on the
 * 3D terrain mesh.
 */

import { lngLatToTilePixel, metersPerPixel, tilePixelToLngLat } from '@core/terrain/tiles';
import type { LngLat } from './geodesy';

/** Lifts the lit surface clear of its own ceiling, so sloped terrain does not speckle. */
export const MASK_BIAS_M = 0.5;
/** Cell budget per axis; the mask is one texture upload per rebuild. */
export const MASK_MAX_PX = 1024;
/** Finer than this buys nothing: the sun is half a degree wide. */
export const MASK_MIN_CELL_M = 2;
/** Origins snap to this many cells, so a small pan asks for the grid the worker already has. */
export const MASK_SNAP_CELLS = 16;
/** Dark desaturated blue-grey; pure black at low opacity reads as grime over a light basemap. */
export const SHADOW_RGB = [26, 36, 54] as const;

/**
 * Local frame for a mask: a Mercator plane scaled to ground metres at `centre`. Cells stay square
 * to within the secant ratio across the rect, and an image source — which interpolates linearly in
 * Mercator — lands every row exactly where it belongs.
 */
export interface MaskFrame {
  /** Normalized Mercator (0..1) of the centre. */
  x: number;
  y: number;
  /** Ground metres per unit of normalized Mercator at the centre. */
  mPerUnit: number;
}

export function maskFrame(centre: LngLat): MaskFrame {
  const t = lngLatToTilePixel(centre.lng, centre.lat, 0, 1);
  return { x: t.px, y: t.py, mPerUnit: metersPerPixel(centre.lat, 0, 1) };
}

export function frameToLngLat(f: MaskFrame, e: number, n: number): LngLat {
  return tilePixelToLngLat(0, 0, 0, f.x + e / f.mPerUnit, f.y - n / f.mPerUnit, 1);
}

export function frameOf(f: MaskFrame, p: LngLat): { e: number; n: number } {
  const t = lngLatToTilePixel(p.lng, p.lat, 0, 1);
  return { e: (t.px - f.x) * f.mPerUnit, n: (f.y - t.py) * f.mPerUnit };
}

/** Grid geometry of a mask; cell (ix, iy) is centred at `originE + ix * cellM`, `originN + iy * cellM`. */
export interface MaskRect {
  originE: number;
  originN: number;
  nx: number;
  ny: number;
  cellM: number;
}

/** Powers of two above the floor, so a pan or a nudge of the zoom keeps the same grid. */
function ladderCell(raw: number): number {
  return MASK_MIN_CELL_M * 2 ** Math.max(0, Math.ceil(Math.log2(raw / MASK_MIN_CELL_M)));
}

/** Smallest snapped grid covering [e0, e1] × [n0, n1] within the cell budget. */
export function maskRect(e0: number, e1: number, n0: number, n1: number): MaskRect {
  // Leaving room for the snap keeps the budget check below from usually having to coarsen.
  const room = MASK_MAX_PX - 2 * MASK_SNAP_CELLS - 1;
  let cellM = ladderCell(Math.max(MASK_MIN_CELL_M, (e1 - e0) / room, (n1 - n0) / room));
  for (;;) {
    const snap = cellM * MASK_SNAP_CELLS;
    const originE = Math.floor(e0 / snap) * snap;
    const originN = Math.floor(n0 / snap) * snap;
    const nx = Math.round((Math.ceil(e1 / snap) * snap - originE) / cellM) + 1;
    const ny = Math.round((Math.ceil(n1 / snap) * snap - originN) / cellM) + 1;
    if (nx <= MASK_MAX_PX && ny <= MASK_MAX_PX) return { originE, originN, nx, ny, cellM };
    cellM *= 2;
  }
}

/** Corner coordinates for an image source: the cells' outer edges, north-west first, clockwise. */
export function maskCorners(centre: LngLat, r: MaskRect): [[number, number], [number, number], [number, number], [number, number]] {
  const f = maskFrame(centre);
  const w = r.originE - r.cellM / 2;
  const e = r.originE + (r.nx - 0.5) * r.cellM;
  const s = r.originN - r.cellM / 2;
  const n = r.originN + (r.ny - 0.5) * r.cellM;
  const at = (E: number, N: number): [number, number] => {
    const p = frameToLngLat(f, E, N);
    return [p.lng, p.lat];
  };
  return [at(w, n), at(e, n), at(e, s), at(w, s)];
}

/**
 * Shadow depth per cell, 0 lit to 255 fully shadowed, ramping over `softM` below the ceiling.
 * Where a building stands `h` is its roof, so the footprint reads lit — the extrusion covers it.
 */
export function shadowMask(h: Float32Array, ceiling: Float32Array, softM: number): Uint8Array {
  const out = new Uint8Array(h.length);
  const inv = 255 / Math.max(softM, 1e-3);
  for (let i = 0; i < h.length; i++) {
    const d = (ceiling[i] - h[i] - MASK_BIAS_M) * inv;
    // NaN height and a -Infinity ceiling both fall through as lit.
    out[i] = d > 0 ? (d >= 255 ? 255 : Math.round(d)) : 0;
  }
  return out;
}

/** RGBA pixels for an `ImageData`; grid row 0 is the southernmost, image row 0 the north edge. */
export function maskPixels(mask: Uint8Array, nx: number, ny: number): Uint8ClampedArray<ArrayBuffer> {
  const px = new Uint8ClampedArray(new ArrayBuffer(nx * ny * 4));
  const [r, g, b] = SHADOW_RGB;
  for (let iy = 0; iy < ny; iy++) {
    const src = (ny - 1 - iy) * nx;
    let o = iy * nx * 4;
    for (let ix = 0; ix < nx; ix++) {
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = mask[src + ix];
      o += 4;
    }
  }
  return px;
}
