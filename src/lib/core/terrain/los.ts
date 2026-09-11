import { curvatureDropM, EARTH_RADIUS_M, elevationAngleDeg, REFRACTION_K } from '@core/geo/geodesy';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export type LosStatus = 'clear' | 'marginal' | 'blocked';

/** Angular margin under which a sightline counts as marginal (DEM error at 10 km is a few tens of metres). */
export const MARGINAL_DEG = 0.1;

export interface LosResult {
  status: LosStatus;
  /** Elevation angle from the eye to the target top, degrees. */
  targetAngleDeg: number;
  /** Highest elevation angle of terrain between the pins, degrees. */
  maxTerrainAngleDeg: number;
  marginDeg: number;
  /** Smallest vertical gap between the sight line and terrain, metres (negative when blocked). */
  minClearanceM: number;
  /** Distance from A of that tightest point, metres. */
  minClearanceAtM: number;
  /** 1 where the ground sample is visible from the eye, 0 where nearer terrain hides it. */
  visible: Uint8Array;
}

/** Height of a sight line leaving the eye at `angleDeg`, measured above the geoid at `distM`. */
export function sightlineHeightM(distM: number, eyeM: number, angleDeg: number): number {
  return eyeM + Math.tan(angleDeg * D2R) * distM + curvatureDropM(distM);
}

/** Dip of the sea horizon for an eye `heightM` above a flat surface, degrees (negative). */
export function flatHorizonDeg(heightM: number): number {
  const r = EARTH_RADIUS_M / (1 - REFRACTION_K);
  return -Math.acos(r / (r + Math.max(0, heightM))) * R2D;
}

/**
 * Point-to-point sightline over a terrain profile from A (index 0) to B (last index).
 * `eyeM` and `targetM` are absolute heights. NaN ground samples are unknown and never block.
 * Samples within `edgeSkipM` of either end belong to the pins' own DEM cells and are not obstacles.
 */
export function analyzeSightline(distM: Float32Array, groundM: Float32Array, eyeM: number, targetM: number, edgeSkipM = 0): LosResult {
  const n = distM.length;
  const total = distM[n - 1];
  const targetAngleDeg = elevationAngleDeg(total, targetM - eyeM);
  const visible = new Uint8Array(n);
  visible[0] = 1;
  let running = -90;
  let maxTerrainAngleDeg = -90;
  let minClearanceM = Infinity;
  let minClearanceAtM = 0;
  for (let i = 1; i < n - 1; i++) {
    const g = groundM[i];
    if (Number.isNaN(g) || distM[i] < edgeSkipM || distM[i] > total - edgeSkipM) {
      visible[i] = 1;
      continue;
    }
    const a = elevationAngleDeg(distM[i], g - eyeM);
    visible[i] = a >= running ? 1 : 0;
    if (a > running) running = a;
    if (a > maxTerrainAngleDeg) maxTerrainAngleDeg = a;
    const clearance = sightlineHeightM(distM[i], eyeM, targetAngleDeg) - g;
    if (clearance < minClearanceM) {
      minClearanceM = clearance;
      minClearanceAtM = distM[i];
    }
  }
  visible[n - 1] = targetAngleDeg >= running ? 1 : 0;
  const marginDeg = targetAngleDeg - maxTerrainAngleDeg;
  const status: LosStatus = marginDeg < 0 ? 'blocked' : marginDeg < MARGINAL_DEG ? 'marginal' : 'clear';
  return { status, targetAngleDeg, maxTerrainAngleDeg, marginDeg, minClearanceM, minClearanceAtM, visible };
}
