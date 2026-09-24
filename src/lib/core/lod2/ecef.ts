/** WGS84 earth-centred coordinates, in Float64: 3D Tiles' native frame. */

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface Geodetic {
  lng: number;
  lat: number;
  /** Ellipsoidal height. */
  h: number;
}

export function geodeticToEcef(lng: number, lat: number, h: number): [number, number, number] {
  const φ = lat * D2R;
  const λ = lng * D2R;
  const s = Math.sin(φ);
  const n = A / Math.sqrt(1 - E2 * s * s);
  return [(n + h) * Math.cos(φ) * Math.cos(λ), (n + h) * Math.cos(φ) * Math.sin(λ), (n * (1 - E2) + h) * s];
}

/** Iterated to well under a millimetre for any point near the surface. */
export function ecefToGeodetic(x: number, y: number, z: number): Geodetic {
  const p = Math.hypot(x, y);
  let φ = Math.atan2(z, p * (1 - E2));
  let h = 0;
  for (let i = 0; i < 6; i++) {
    const s = Math.sin(φ);
    const n = A / Math.sqrt(1 - E2 * s * s);
    // Near the poles cos φ vanishes; take h from z instead.
    h = Math.abs(φ) < 1.2 ? p / Math.cos(φ) - n : z / s - n * (1 - E2);
    φ = Math.atan2(z, p * (1 - (E2 * n) / (n + h)));
  }
  return { lng: Math.atan2(y, x) * R2D, lat: φ * R2D, h };
}
