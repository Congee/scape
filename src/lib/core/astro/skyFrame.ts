import { BaryState, Body, C_AUDAY, Rotation_EQD_HOR, Rotation_EQJ_HOR, Rotation_HOR_EQJ, type Observer, type RotationMatrix } from 'astronomy-engine';
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

/** J2000 catalogue direction → local apparent place: the rotation plus annual aberration. */
export interface StarFrame {
  m: Mat3;
  /** Earth's barycentric velocity over c, J2000. */
  beta: readonly [number, number, number];
  /** `beta` in the local frame. */
  ab: Float64Array;
}

/** `beta` may come from a nearby time; the aberration it gives drifts under 0.4″ a day. */
export function starFrame(time: Date, obs: Observer, beta?: StarFrame['beta']): StarFrame {
  const m = eqjToEnu(time, obs);
  if (!beta) {
    const v = BaryState(Body.Earth, time);
    beta = [v.vx / C_AUDAY, v.vy / C_AUDAY, v.vz / C_AUDAY];
  }
  const ab = new Float64Array(3);
  apply(m, beta[0], beta[1], beta[2], ab);
  return { m, beta, ab };
}

/** Unit local direction of a unit J2000 direction; first-order aberration is good to 1 mas. */
export function applyStar(f: StarFrame, x: number, y: number, z: number, out: Float64Array): void {
  apply(f.m, x, y, z, out);
  const a = out[0] + f.ab[0];
  const b = out[1] + f.ab[1];
  const c = out[2] + f.ab[2];
  const k = 1 / Math.hypot(a, b, c);
  out[0] = a * k;
  out[1] = b * k;
  out[2] = c * k;
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

/** A local unit vector lifted toward the zenith by refraction in air of `density`, written to `out`. */
export function refractEnu(e: number, n: number, u: number, out: Float64Array, density = 1): Float64Array {
  const g = Math.asin(Math.max(-1, Math.min(1, u)));
  const a = apparentAltitude(g * R2D, density) / R2D;
  const k = Math.cos(g) > 1e-9 ? Math.cos(a) / Math.cos(g) : 1;
  out[0] = e * k;
  out[1] = n * k;
  out[2] = Math.sin(a);
  return out;
}

export interface AzAlt {
  azimuthDeg: number;
  altitudeDeg: number;
}

/** Azimuth/altitude of a local unit vector, refracted in air of `density` (0 geometric). */
export function horizontalOf(e: number, n: number, u: number, density = 1): AzAlt {
  const az = Math.atan2(e, n) * R2D;
  const alt = Math.asin(Math.max(-1, Math.min(1, u))) * R2D;
  return { azimuthDeg: ((az % 360) + 360) % 360, altitudeDeg: apparentAltitude(alt, density) };
}
