/** Web-Mercator tile maths for square DEM tiles. */

export const TILE_SIZE = 256;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const MAX_LAT = 85.05112878;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export interface TilePixel extends TileCoord {
  /** Fractional pixel position inside the tile, 0..size. */
  px: number;
  py: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

/** Ground size of one pixel at `lat`, metres. */
export function metersPerPixel(lat: number, z: number, size = TILE_SIZE): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos(lat * D2R)) / (size * 2 ** z);
}

/**
 * Integer zoom whose pixels are closest to `metersPerPx` at `lat`, clamped to [minZ, maxZ].
 * `size` is the tile's post count, and the answer depends on it: 512 px tiles reach a given
 * ground resolution one zoom lower than 256 px ones.
 */
export function zoomForResolution(lat: number, metersPerPx: number, minZ: number, maxZ: number, size = TILE_SIZE): number {
  const z = Math.log2((EARTH_CIRCUMFERENCE_M * Math.cos(lat * D2R)) / (size * metersPerPx));
  return clamp(Math.round(z), minZ, maxZ);
}

export function lngLatToTilePixel(lng: number, lat: number, z: number, size = TILE_SIZE): TilePixel {
  const n = 2 ** z;
  const φ = clamp(lat, -MAX_LAT, MAX_LAT) * D2R;
  const xf = ((lng + 180) / 360) * n;
  const yf = ((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * n;
  const xi = Math.floor(xf);
  const yi = clamp(Math.floor(yf), 0, n - 1);
  return { z, x: ((xi % n) + n) % n, y: yi, px: (xf - xi) * size, py: clamp((yf - yi) * size, 0, size) };
}

/** Inverse of `lngLatToTilePixel` for a fractional pixel inside tile (z, x, y). */
export function tilePixelToLngLat(z: number, x: number, y: number, px: number, py: number, size = TILE_SIZE): { lng: number; lat: number } {
  const n = 2 ** z;
  const lng = ((x + px / size) / n) * 360 - 180;
  const yf = (y + py / size) / n;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * yf))) * R2D;
  return { lng, lat };
}

/** Tiles at zoom `z` overlapping a normalized Mercator extent (0..1 on both axes). */
export function tilesInBounds(b: { x0: number; x1: number; y0: number; y1: number }, z: number): TileCoord[] {
  const n = 2 ** z;
  const x0 = clamp(Math.floor(b.x0 * n), 0, n - 1);
  const x1 = clamp(Math.floor(b.x1 * n), 0, n - 1);
  const y0 = clamp(Math.floor(b.y0 * n), 0, n - 1);
  const y1 = clamp(Math.floor(b.y1 * n), 0, n - 1);
  const out: TileCoord[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y });
  return out;
}
