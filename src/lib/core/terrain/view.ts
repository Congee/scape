import { elevationAngleDeg } from '@core/geo/geodesy';
import { elevationAt, type DemSource } from './dem';
import type { SweepPlan } from './horizon';
import { flatHorizonDeg } from './los';

/**
 * Layered terrain view over an azimuth window: per column, the terrain points visible from the eye
 * in order of distance. Angles increase along a column, so the ground between two points is the
 * nearer point's slope and everything above the last point is sky.
 */
export interface ViewProfile {
  azFromDeg: number;
  azStepDeg: number;
  nAz: number;
  /** Visible points for column i are [start[i], start[i + 1]). */
  start: Int32Array;
  angleDeg: Float32Array;
  distM: Float32Array;
  /** Skyline per column (flat-horizon fallback where nothing was sampled). */
  skylineDeg: Float32Array;
  skylineDistM: Float32Array;
  rangeM: number;
}

export function sweepView(src: DemSource, plan: SweepPlan, eyeM: number, eyeAboveGroundM: number, rangeM: number, minStepDeg = 0.02): ViewProfile {
  const nAz = plan.nAz;
  const start = new Int32Array(nAz + 1);
  const angles: number[] = [];
  const dists: number[] = [];
  const skylineDeg = new Float32Array(nAz);
  const skylineDistM = new Float32Array(nAz);
  const fallback = flatHorizonDeg(eyeAboveGroundM);
  for (let i = 0; i < nAz; i++) {
    start[i] = angles.length;
    let running = -Infinity;
    let runningD = 0;
    let lastRecorded = -Infinity;
    for (let j = plan.start[i]; j < plan.start[i + 1]; j++) {
      const g = elevationAt(src, plan.lng[j], plan.lat[j], plan.zoom[j]);
      if (Number.isNaN(g)) continue;
      const a = elevationAngleDeg(plan.distM[j], Math.max(g, 0) - eyeM);
      if (a <= running) continue;
      running = a;
      runningD = plan.distM[j];
      if (a >= lastRecorded + minStepDeg) {
        angles.push(a);
        dists.push(runningD);
        lastRecorded = a;
      }
    }
    if (running > lastRecorded) {
      angles.push(running);
      dists.push(runningD);
    }
    skylineDeg[i] = running === -Infinity ? fallback : running;
    skylineDistM[i] = runningD;
  }
  start[nAz] = angles.length;
  return { azFromDeg: plan.azFromDeg, azStepDeg: plan.azStepDeg, nAz, start, angleDeg: Float32Array.from(angles), distM: Float32Array.from(dists), skylineDeg, skylineDistM, rangeM };
}

/** Column index for an azimuth, or -1 outside the window. */
export function columnAt(v: ViewProfile, azDeg: number): number {
  const rel = (((azDeg - v.azFromDeg) % 360) + 360) % 360;
  const i = Math.round(rel / v.azStepDeg);
  if (i < v.nAz) return i;
  // Just past the last column on a full circle wraps to column 0.
  return v.nAz * v.azStepDeg >= 360 - 1e-6 ? 0 : -1;
}

/** Index of the visible terrain point covering `altDeg` in a column, or -1 when that altitude is sky. */
export function surfaceAt(v: ViewProfile, col: number, altDeg: number): number {
  let lo = v.start[col];
  let hi = v.start[col + 1];
  if (lo === hi || altDeg > v.angleDeg[hi - 1]) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (v.angleDeg[mid] >= altDeg) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Whether a point at (azimuth, elevation angle, distance) is hidden behind nearer terrain. */
export function occluded(v: ViewProfile, azDeg: number, altDeg: number, distM: number): boolean {
  const col = columnAt(v, azDeg);
  if (col < 0) return false;
  let maxBefore = -Infinity;
  for (let m = v.start[col]; m < v.start[col + 1] && v.distM[m] < distM; m++) maxBefore = v.angleDeg[m];
  return altDeg < maxBefore;
}

/**
 * A view over grid columns `k0`..`k0 + nAz - 1`, each copied from the profile `pick` names; columns
 * only depend on their own azimuth, so a pan keeps the ones it already swept.
 */
export function assembleView(azStepDeg: number, k0: number, nAz: number, rangeM: number, pick: (k: number) => { v: ViewProfile; col: number }): ViewProfile {
  const src = Array.from({ length: nAz }, (_, i) => pick(k0 + i));
  const start = new Int32Array(nAz + 1);
  for (let i = 0; i < nAz; i++) start[i + 1] = start[i] + src[i].v.start[src[i].col + 1] - src[i].v.start[src[i].col];
  const angleDeg = new Float32Array(start[nAz]);
  const distM = new Float32Array(start[nAz]);
  const skylineDeg = new Float32Array(nAz);
  const skylineDistM = new Float32Array(nAz);
  for (let i = 0; i < nAz; i++) {
    const { v, col } = src[i];
    angleDeg.set(v.angleDeg.subarray(v.start[col], v.start[col + 1]), start[i]);
    distM.set(v.distM.subarray(v.start[col], v.start[col + 1]), start[i]);
    skylineDeg[i] = v.skylineDeg[col];
    skylineDistM[i] = v.skylineDistM[col];
  }
  return { azFromDeg: k0 * azStepDeg, azStepDeg, nAz, start, angleDeg, distM, skylineDeg, skylineDistM, rangeM };
}
