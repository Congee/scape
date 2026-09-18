/**
 * The equirectangular frame the viewfinder's ceiling grids are laid out in: metres east and north
 * of the camera pin, with the east scale taken at the sample's own latitude. Terrain filling maps
 * forward through it and building footprints map back, so both directions live here.
 */

import { EARTH_RADIUS_M } from './geodesy';

const D2R = Math.PI / 180;

/** Metres per degree of latitude. */
export const M_PER_DEG = EARTH_RADIUS_M * D2R;

/** Latitude `n` metres north of `pinLat`. */
export function pinFrameLat(pinLat: number, n: number): number {
  return pinLat + n / M_PER_DEG;
}

/** Metres per degree of longitude at `lat`. */
export function mPerDegLng(lat: number): number {
  return M_PER_DEG * Math.cos(lat * D2R);
}
