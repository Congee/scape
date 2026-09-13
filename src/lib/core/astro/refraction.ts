import { Refraction } from 'astronomy-engine';

/** Geometric altitude of a body's centre at rise/set under standard refraction. */
export const HORIZON_ALT_DEG = -0.8333;

/** Apparent altitude: refraction only while the body is up; below the horizon the geometric value, which twilight thresholds are defined on. */
export function apparentAltitude(geomAltDeg: number): number {
  return geomAltDeg >= HORIZON_ALT_DEG ? geomAltDeg + Refraction('normal', geomAltDeg) : geomAltDeg;
}
