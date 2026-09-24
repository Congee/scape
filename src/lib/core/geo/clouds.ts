import { EARTH_RADIUS_M, elevationAngleDeg, heightAtAngle, REFRACTION_K } from './geodesy';

const D2R = Math.PI / 180;

/** Ground distance to a cloud base at `cloudM` seen `angleDeg` up; curvature and refraction included. */
export function cloudDistanceM(cloudM: number, angleDeg: number, eyeM = 0, k = REFRACTION_K): number | null {
  const re = EARTH_RADIUS_M / (1 - k);
  const t = Math.tan(angleDeg * D2R);
  const dh = cloudM - eyeM;
  const disc = t * t + (2 * dh) / re;
  if (disc < 0 || (dh < 0 && t >= 0)) return null;
  // Nearest positive root of d²/(2Re) + d·tanα − Δh = 0.
  const d = dh >= 0 ? re * (Math.sqrt(disc) - t) : re * (-t - Math.sqrt(disc));
  return d > 0 ? d : null;
}

export const cloudAngleDeg = (cloudM: number, distM: number, eyeM = 0, k = REFRACTION_K) => elevationAngleDeg(distM, cloudM - eyeM, k);

export const cloudHeightM = (distM: number, angleDeg: number, eyeM = 0, k = REFRACTION_K) => heightAtAngle(eyeM, distM, angleDeg, k);
