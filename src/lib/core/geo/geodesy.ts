/** Spherical-Earth geodesy. Against WGS84: distances within 0.6%, bearings within 0.2°. */

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

/** Standard terrestrial refraction coefficient; light bends down, so the Earth looks slightly flatter. */
export const REFRACTION_K = 0.13;

/** Curvature drop of the surface below the observer's tangent plane at `distM`, refraction included. */
export function curvatureDropM(distM: number, k = REFRACTION_K): number {
  return distM ** 2 / (2 * (EARTH_RADIUS_M / (1 - k)));
}

/** Elevation angle from observer to a target given horizontal distance and height difference. */
export function elevationAngleDeg(distM: number, dHeightM: number, k = REFRACTION_K): number {
  return Math.atan2(dHeightM - curvatureDropM(distM, k), distM) * R2D;
}

/** Inverse of `elevationAngleDeg`: height of a point seen at `angleDeg` from an eye at `eyeM`. */
export function heightAtAngle(eyeM: number, distM: number, angleDeg: number, k = REFRACTION_K): number {
  return eyeM + distM * Math.tan(angleDeg * D2R) + curvatureDropM(distM, k);
}

/** Point a fraction `f` (0..1) along the great circle from a to b. */
export function intermediatePoint(a: LngLat, b: LngLat, f: number): LngLat {
  const φ1 = a.lat * D2R;
  const λ1 = a.lng * D2R;
  const φ2 = b.lat * D2R;
  const λ2 = b.lng * D2R;
  const δ = distanceM(a, b) / EARTH_RADIUS_M;
  if (δ < 1e-12) return { ...a };
  const A = Math.sin((1 - f) * δ) / Math.sin(δ);
  const B = Math.sin(f * δ) / Math.sin(δ);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return { lng: normalizeLng(Math.atan2(y, x) * R2D), lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * R2D };
}

/** Densified great-circle path from a to b as GeoJSON positions, longitude kept continuous. */
export function geodesicPath(a: LngLat, b: LngLat, segments = 32): [number, number][] {
  const out: [number, number][] = [[a.lng, a.lat]];
  let prevLng = a.lng;
  for (let i = 1; i <= segments; i++) {
    const p = intermediatePoint(a, b, i / segments);
    let lng = p.lng;
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    prevLng = lng;
    out.push([lng, p.lat]);
  }
  return out;
}
