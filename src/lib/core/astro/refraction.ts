const D2R = Math.PI / 180;

/** Geometric altitude of a body's centre at rise/set under standard refraction. */
export const HORIZON_ALT_DEG = -0.8333;

/** Geometric altitudes where refraction starts to taper and where it reaches zero. */
export const TAPER_START_DEG = -1.5;
export const TAPER_END_DEG = -3;

/** Saemundsson, frozen below −1° as JPL Horizons does. */
function saemundssonDeg(geomAltDeg: number): number {
  const h = Math.max(geomAltDeg, -1);
  return Math.max(0, 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * D2R) / 60);
}

/** Refraction of a geometric altitude in the sea-level standard atmosphere, degrees. */
export function refractionDeg(geomAltDeg: number): number {
  if (geomAltDeg <= TAPER_END_DEG) return 0;
  const r = saemundssonDeg(geomAltDeg);
  if (geomAltDeg >= TAPER_START_DEG) return r;
  const t = (geomAltDeg - TAPER_END_DEG) / (TAPER_START_DEG - TAPER_END_DEG);
  return r * t * t * (3 - 2 * t);
}

/** Apparent altitude; below the taper the geometric value, which twilight thresholds are defined on. */
export function apparentAltitude(geomAltDeg: number): number {
  return geomAltDeg + refractionDeg(geomAltDeg);
}

/** Apparent altitude of a body's centre at the standard rise/set. */
export const RISE_APPARENT_DEG = apparentAltitude(HORIZON_ALT_DEG);
