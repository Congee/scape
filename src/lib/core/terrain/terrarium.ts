/** Terrarium encoding, the inverse of `decodeTerrarium`. */

import { TILE_SIZE } from './tiles';

/** The format's own quantum: one blue unit is 1/256 m. */
export const TERRARIUM_STEP_M = 1 / 256;
/** Representable envelope, from rgb(0,0,0) to rgb(255,255,255). */
export const TERRARIUM_MIN_M = -32768;
export const TERRARIUM_MAX_M = 32768 - TERRARIUM_STEP_M;

/**
 * Elevations in metres to RGBA bytes: (R * 256 + G + B / 256) - 32768. Alpha is opaque.
 * Heights are quantised to the nearest 1/256 m rather than truncated, so a resampled
 * fractional metre keeps its fraction. NaN and out-of-range posts take the rgb(0,0,0)
 * nodata sentinel, which every decoder here already treats as missing.
 */
export function encodeTerrarium(elev: ArrayLike<number>, size = TILE_SIZE): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let i = 0, p = 0; i < size * size; i++, p += 4) {
    let u = Math.round((elev[i] - TERRARIUM_MIN_M) * 256);
    if (!(u >= 0)) u = 0;
    else if (u > 0xffffff) u = 0xffffff;
    out[p] = u >>> 16;
    out[p + 1] = (u >>> 8) & 255;
    out[p + 2] = u & 255;
    out[p + 3] = 255;
  }
  return out;
}

/**
 * Terrarium RGBA in a `(size + 4)²` buffer with the real pixels at (2, 2), the layout MapLibre's
 * `DEMData` expects: it replicates the edges into the 2 px border itself, so the border is left as
 * allocated.
 */
export function encodeTerrariumPadded(elev: ArrayLike<number>, size = TILE_SIZE): Uint8ClampedArray<ArrayBuffer> {
  const stride = size + 4;
  const out = new Uint8ClampedArray(new ArrayBuffer(stride * stride * 4));
  const rgba = encodeTerrarium(elev, size);
  const row = size * 4;
  for (let y = 0; y < size; y++) out.set(rgba.subarray(y * row, (y + 1) * row), ((y + 2) * stride + 2) * 4);
  return out;
}
