import { lngLatToTilePixel, TILE_SIZE } from './tiles';

/** One decoded DEM tile: elevations in metres, row-major, NaN where unknown. */
export interface DemTile {
  z: number;
  x: number;
  y: number;
  size: number;
  elev: Float32Array;
}

/**
 * Synchronous tile lookup. `undefined` = not loaded, `null` = known to be missing.
 * Loading happens elsewhere (worker cache); the core stays pure.
 */
export interface DemSource {
  get(z: number, x: number, y: number): DemTile | null | undefined;
}

/** Terrarium encoding: (R * 256 + G + B / 256) - 32768 metres. `channels` is the pixel stride (3 RGB, 4 RGBA). */
export function decodeTerrarium(pixels: ArrayLike<number>, size = TILE_SIZE, channels = 4): Float32Array {
  const out = new Float32Array(size * size);
  for (let i = 0, p = 0; i < out.length; i++, p += channels) out[i] = pixels[p] * 256 + pixels[p + 1] + pixels[p + 2] / 256 - 32768;
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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

/** Elevation at a point from tiles of zoom `z`; NaN when the tile is unavailable. */
export function elevationAt(src: DemSource, lng: number, lat: number, z: number): number {
  const t = lngLatToTilePixel(lng, lat, z, 1);
  const tile = src.get(t.z, t.x, t.y);
  return tile ? sampleTile(tile, t.px * tile.size, t.py * tile.size) : NaN;
}
