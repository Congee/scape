/** Spherical-Earth geodesy. Accuracy (~0.3%) is ample for drawing and planning distances. */

export const EARTH_RADIUS_M = 6371008.8;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface LngLat {
  lng: number;
  lat: number;
}

export function normalizeLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Great-circle distance in metres. */
export function distanceM(a: LngLat, b: LngLat): number {
  const φ1 = a.lat * D2R;
  const φ2 = b.lat * D2R;
  const dφ = φ2 - φ1;
  const dλ = (b.lng - a.lng) * D2R;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from true north. */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const φ1 = a.lat * D2R;
  const φ2 = b.lat * D2R;
  const dλ = (b.lng - a.lng) * D2R;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return normalizeBearing(Math.atan2(y, x) * R2D);
}

/** Point reached travelling `distM` along `bearing` from `from` on a great circle. */
export function destination(from: LngLat, bearing: number, distM: number): LngLat {
  const δ = distM / EARTH_RADIUS_M;
  const θ = bearing * D2R;
  const φ1 = from.lat * D2R;
  const λ1 = from.lng * D2R;
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(Math.max(-1, Math.min(1, sinφ2)));
  const y = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
  const x = Math.cos(δ) - Math.sin(φ1) * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);
  return { lng: normalizeLng(λ2 * R2D), lat: φ2 * R2D };
}

/**
 * Densified great-circle ray as GeoJSON positions, so long lines stay geodesic on a
 * Mercator map (TPE draws FOV edges this way).
 */
export function geodesicRay(
  from: LngLat,
  bearing: number,
  distM: number,
  segments = 32
): [number, number][] {
  const out: [number, number][] = [[from.lng, from.lat]];
  let prevLng = from.lng;
  for (let i = 1; i <= segments; i++) {
    const p = destination(from, bearing, (distM * i) / segments);
    // Keep longitude continuous across the antimeridian for rendering.
    let lng = p.lng;
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    prevLng = lng;
    out.push([lng, p.lat]);
  }
  return out;
}

/** Elevation angle from observer to a target given horizontal distance and height difference. */
export function elevationAngleDeg(distM: number, dHeightM: number): number {
  // Includes the drop of the Earth's surface below the tangent plane.
  const drop = distM ** 2 / (2 * EARTH_RADIUS_M);
  return Math.atan2(dHeightM - drop, distM) * R2D;
}
