/**
 * The pin's local east-north-up frame on WGS84: exact ECEF rotations, set up once per pin. Terrain
 * posts, building footprints and models all live in it, so their azimuths match the geodesic bearing
 * and the Sun's topocentric azimuth. `e` and `n` are tangent-plane metres; heights stay the caller's.
 */

import { normalizeLng, WGS84_A, WGS84_F, type LngLat } from './geodesy';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const E2 = WGS84_F * (2 - WGS84_F);
const B = WGS84_A * (1 - WGS84_F);

export interface PinFrame {
  readonly pin: LngLat;
  /** Tangent-plane east and north metres of the ground point at lng/lat. */
  toEn(lng: number, lat: number): [number, number];
  /** The ground point whose tangent-plane position is (e, n); exact inverse of `toEn`. */
  fromEn(e: number, n: number): LngLat;
}

export function pinFrame(pin: LngLat): PinFrame {
  // ECEF rotated about the axis so the pin sits at longitude 0: x toward the pin's meridian.
  const sφ0 = Math.sin(pin.lat * D2R);
  const cφ0 = Math.cos(pin.lat * D2R);
  const N0 = WGS84_A / Math.sqrt(1 - E2 * sφ0 * sφ0);
  const x0 = N0 * cφ0;
  const z0 = N0 * (1 - E2) * sφ0;
  // The up vector (cφ0, 0, sφ0) scaled into unit-sphere space for the ray-ellipsoid quadratic.
  const ux = cφ0 / WGS84_A;
  const uz = sφ0 / B;
  const qa = ux * ux + uz * uz;
  return {
    pin,
    toEn(lng, lat) {
      const sφ = Math.sin(lat * D2R);
      const cφ = Math.cos(lat * D2R);
      const dλ = (lng - pin.lng) * D2R;
      const N = WGS84_A / Math.sqrt(1 - E2 * sφ * sφ);
      const dx = N * cφ * Math.cos(dλ) - x0;
      const dz = N * (1 - E2) * sφ - z0;
      return [N * cφ * Math.sin(dλ), cφ0 * dz - sφ0 * dx];
    },
    fromEn(e, n) {
      if (e === 0 && n === 0) return pin;
      const x = x0 - sφ0 * n;
      const z = z0 + cφ0 * n;
      // Drop along the pin's up axis onto the ellipsoid: the root of qa t² + 2 qb t + qc nearest 0.
      const px = x / WGS84_A;
      const py = e / WGS84_A;
      const pz = z / B;
      const qb = px * ux + pz * uz;
      const qc = px * px + py * py + pz * pz - 1;
      const t = -qc / (qb + Math.sqrt(qb * qb - qa * qc));
      const X = x + t * cφ0;
      const Z = z + t * sφ0;
      return { lng: normalizeLng(pin.lng + Math.atan2(e, X) * R2D), lat: Math.atan2(Z, (1 - E2) * Math.hypot(X, e)) * R2D };
    }
  };
}

let last: PinFrame | null = null;

/** `pinFrame` memoised on the last pin, for hot loops that are handed only the pin. */
export function frameAt(pin: LngLat): PinFrame {
  if (last === null || last.pin.lng !== pin.lng || last.pin.lat !== pin.lat) last = pinFrame({ lng: pin.lng, lat: pin.lat });
  return last;
}
