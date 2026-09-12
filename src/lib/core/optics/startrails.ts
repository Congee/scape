const D2R = Math.PI / 180;

/** Apparent sidereal drift of a star on the celestial equator. */
export const SIDEREAL_DEG_PER_S = 360 / 86_164.0905;

/** Longest exposure before stars trail by the "500 rule" (or 600, 400…), seconds. */
export function ruleOfN(focalMm: number, cropFactor = 1, constant = 500): number {
  return constant / (focalMm * cropFactor);
}

export function pixelPitchUm(sensorWidthMm: number, pixelsWide: number): number {
  return (sensorWidthMm / pixelsWide) * 1000;
}

/**
 * NPF rule (Frédéric Michaud, Société Astronomique du Havre), accurate form: seconds before a star
 * spreads beyond its Airy disc, for aperture N, focal length f (mm), pixel pitch p (µm) and declination.
 */
export function npfShutterS(fNumber: number, focalMm: number, pitchUm: number, decDeg = 0): number {
  const cos = Math.max(0.05, Math.cos(decDeg * D2R));
  return (16.856 * fNumber + 0.0997 * focalMm + 13.713 * pitchUm) / (focalMm * cos);
}

/** Sky angle a star at `decDeg` moves through during an exposure. */
export function trailAngleDeg(exposureS: number, decDeg = 0): number {
  return SIDEREAL_DEG_PER_S * exposureS * Math.cos(decDeg * D2R);
}

export function trailLengthMm(exposureS: number, focalMm: number, decDeg = 0): number {
  return focalMm * Math.tan(trailAngleDeg(exposureS, decDeg) * D2R);
}

export function trailLengthPx(exposureS: number, focalMm: number, pitchUm: number, decDeg = 0): number {
  return (trailLengthMm(exposureS, focalMm, decDeg) * 1000) / pitchUm;
}
