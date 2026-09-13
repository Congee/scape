import { Rotation_EQD_HOR, Rotation_EQJ_HOR, Rotation_HOR_EQJ, type Observer, type RotationMatrix } from 'astronomy-engine';
import { apparentAltitude } from './refraction';

const R2D = 180 / Math.PI;

/** Row-major 3×3: out_i = Σ_j m[3i + j]·v_j. */
export type Mat3 = Float64Array;

/** astronomy-engine applies `rot[j][i]`; its HOR frame is (north, west, up). */
function rows(rot: RotationMatrix): number[][] {
  const r = rot.rot;
  return [0, 1, 2].map((i) => [r[0][i], r[1][i], r[2][i]]);
}

/** Equatorial J2000 → local east/north/up at the time and place. */
export function eqjToEnu(time: Date, obs: Observer): Mat3 {
  const [n, w, u] = rows(Rotation_EQJ_HOR(time, obs));
  return new Float64Array([-w[0], -w[1], -w[2], n[0], n[1], n[2], u[0], u[1], u[2]]);
}

/** Local east/north/up → equatorial J2000. */
export function enuToEqj(time: Date, obs: Observer): Mat3 {
  const m = rows(Rotation_HOR_EQJ(time, obs));
  // Input HOR vector is (n, −e, u).
  return new Float64Array([-m[0][1], m[0][0], m[0][2], -m[1][1], m[1][0], m[1][2], -m[2][1], m[2][0], m[2][2]]);
}

/** Local direction of the true celestial pole (equator of date). */
export function poleEnu(time: Date, obs: Observer): [number, number, number] {
  const [n, w, u] = rows(Rotation_EQD_HOR(time, obs));
  return [-w[2], n[2], u[2]];
}

export function apply(m: Mat3, x: number, y: number, z: number, out: Float64Array): void {
  out[0] = m[0] * x + m[1] * y + m[2] * z;
  out[1] = m[3] * x + m[4] * y + m[5] * z;
  out[2] = m[6] * x + m[7] * y + m[8] * z;
}

export interface AzAlt {
  azimuthDeg: number;
  altitudeDeg: number;
}

/** Azimuth/altitude of a local unit vector; apparent altitude when `refract`. */
export function horizontalOf(e: number, n: number, u: number, refract = true): AzAlt {
  const az = Math.atan2(e, n) * R2D;
  const alt = Math.asin(Math.max(-1, Math.min(1, u))) * R2D;
  return { azimuthDeg: ((az % 360) + 360) % 360, altitudeDeg: refract ? apparentAltitude(alt) : alt };
}
