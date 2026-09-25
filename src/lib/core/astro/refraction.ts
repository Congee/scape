import { Atmosphere } from 'astronomy-engine';

const D2R = Math.PI / 180;

/** Horizon refraction SearchRiseSet assumes in sea-level air. */
export const REFRACTION_NEAR_HORIZON_DEG = 34 / 60;
/** Mean semidiameter the standard rise/set altitude assumes. */
const RISE_SEMIDIAMETER_DEG = 16 / 60;

/** Geometric altitudes where refraction starts to taper and where it reaches zero. */
export const TAPER_START_DEG = -1.5;
export const TAPER_END_DEG = -3;

/** Saemundsson, frozen below −1° as JPL Horizons does. */
function saemundssonDeg(geomAltDeg: number): number {
  const h = Math.max(geomAltDeg, -1);
  return Math.max(0, 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * D2R) / 60);
}

/** Air density relative to sea level at a height, the standard atmosphere astronomy-engine's rise/set scale by. */
export function airDensity(heightM: number): number {
  return Number.isFinite(heightM) ? Atmosphere(Math.min(Math.max(heightM, -500), 100_000)).density : 1;
}

/** Refraction of a geometric altitude, degrees; `density` 1 is the sea-level standard atmosphere, 0 airless. */
export function refractionDeg(geomAltDeg: number, density = 1): number {
  if (geomAltDeg <= TAPER_END_DEG) return 0;
  const r = saemundssonDeg(geomAltDeg) * density;
  if (geomAltDeg >= TAPER_START_DEG) return r;
  const t = (geomAltDeg - TAPER_END_DEG) / (TAPER_START_DEG - TAPER_END_DEG);
  return r * t * t * (3 - 2 * t);
}

/** Apparent altitude; below the taper the geometric value, which twilight thresholds are defined on. */
export function apparentAltitude(geomAltDeg: number, density = 1): number {
  return geomAltDeg + refractionDeg(geomAltDeg, density);
}

/** Geometric altitude of a body's centre at the standard rise/set in air of `density`; −50′ at sea level. */
export function horizonAltDeg(density: number): number {
  return -(RISE_SEMIDIAMETER_DEG + REFRACTION_NEAR_HORIZON_DEG * density);
}

/** Apparent altitude of a body's centre at the standard rise/set, seen in air of `density`. */
export function riseApparentDeg(density: number): number {
  return apparentAltitude(horizonAltDeg(density), density);
}
