import { metersPerPixel, tilePixelToLngLat } from './tiles';

/** Upper edges of the slope bands, degrees; the last band is open-ended. */
export const SLOPE_BANDS_DEG = [15, 30, 35, 45] as const;
/** Below this, aspect is noise and left unshaded. */
export const ASPECT_MIN_SLOPE_DEG = 2;

export interface SlopeAspect {
  slopeDeg: number;
  /** Downslope compass bearing, degrees clockwise from north. */
  aspectDeg: number;
}

/** Horn's gradient of a 3×3 window (row-major, north row first) with square cells `cellM` metres. */
export function hornSlope(e: ArrayLike<number>, cellM: number): SlopeAspect {
  const dzdx = (e[2] + 2 * e[5] + e[8] - (e[0] + 2 * e[3] + e[6])) / (8 * cellM);
  const dzdy = (e[0] + 2 * e[1] + e[2] - (e[6] + 2 * e[7] + e[8])) / (8 * cellM);
  return fromGradient(dzdx, dzdy);
}

/** Slope and downslope bearing from east and north elevation gradients. */
export function fromGradient(dzdx: number, dzdy: number): SlopeAspect {
  const slopeDeg = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
  const aspectDeg = ((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI + 360) % 360;
  return { slopeDeg, aspectDeg };
}

/** Band index 0…4 of a slope, per `SLOPE_BANDS_DEG`. */
export function slopeBand(slopeDeg: number): number {
  return SLOPE_BANDS_DEG.filter((b) => slopeDeg >= b).length;
}

/**
 * Slope at post (i, j) of a DEM tile stored like MapLibre's DEMData: `dim` posts a side inside a
 * 2-post border, so the array is (dim + 4)² and post (i, j) sits at (i + 2, j + 2).
 */
export function tileSlopeAt(elev: ArrayLike<number>, dim: number, z: number, tileY: number, i: number, j: number): SlopeAspect {
  const stride = dim + 4;
  const w: number[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) w.push(elev[(j + 2 + dy) * stride + i + 2 + dx]);
  const { lat } = tilePixelToLngLat(z, 0, tileY, 0, j + 0.5, dim);
  return hornSlope(w, metersPerPixel(lat, z, dim));
}
