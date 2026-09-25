import { elevationAngleDeg } from '@core/geo/geodesy';
import { elevationAt, type DemSource } from './dem';
import { planRefinement, requiredTiles, type RefineOptions, type SweepPlan } from './horizon';
import { flatHorizonDeg } from './los';
import type { TileCoord } from './tiles';

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

/** Builds a ViewProfile column by column from samples fed in distance order. */
class Layers {
  readonly start: Int32Array;
  readonly skylineDeg: Float32Array;
  readonly skylineDistM: Float32Array;
  private angles: number[] = [];
  private dists: number[] = [];
  private running = -Infinity;
  private runningD = 0;
  private lastRecorded = -Infinity;

  constructor(
    private nAz: number,
    private minStepDeg: number,
    private fallback: number
  ) {
    this.start = new Int32Array(nAz + 1);
    this.skylineDeg = new Float32Array(nAz);
    this.skylineDistM = new Float32Array(nAz);
  }

  begin(i: number): void {
    this.start[i] = this.angles.length;
    this.running = -Infinity;
    this.runningD = 0;
    this.lastRecorded = -Infinity;
  }

  add(a: number, d: number): void {
    if (a <= this.running) return;
    this.running = a;
    this.runningD = d;
    if (a >= this.lastRecorded + this.minStepDeg) {
      this.angles.push(a);
      this.dists.push(d);
      this.lastRecorded = a;
    }
  }

  end(i: number): void {
    if (this.running > this.lastRecorded) {
      this.angles.push(this.running);
      this.dists.push(this.runningD);
    }
    this.skylineDeg[i] = this.running === -Infinity ? this.fallback : this.running;
    this.skylineDistM[i] = this.runningD;
  }

  view(plan: SweepPlan, rangeM: number): ViewProfile {
    this.start[this.nAz] = this.angles.length;
    const { start, skylineDeg, skylineDistM } = this;
    return { azFromDeg: plan.azFromDeg, azStepDeg: plan.azStepDeg, nAz: this.nAz, start, angleDeg: Float32Array.from(this.angles), distM: Float32Array.from(this.dists), skylineDeg, skylineDistM, rangeM };
  }
}

export function sweepView(src: DemSource, plan: SweepPlan, eyeM: number, eyeAboveGroundM: number, rangeM: number, minStepDeg = 0.02): ViewProfile {
  const out = new Layers(plan.nAz, minStepDeg, flatHorizonDeg(eyeAboveGroundM));
  for (let i = 0; i < plan.nAz; i++) {
    out.begin(i);
    for (let j = plan.start[i]; j < plan.start[i + 1]; j++) {
      const g = elevationAt(src, plan.lng[j], plan.lat[j], plan.zoom[j]);
      if (!Number.isNaN(g)) out.add(elevationAngleDeg(plan.distM[j], g - eyeM), plan.distM[j]);
    }
    out.end(i);
  }
  return out.view(plan, rangeM);
}

/** A view sweep with a finer pass near the skyline, like `refineHorizon`: the coarse view, the fine tiles, and the refined view. */
export interface ViewRefinement {
  coarse: ViewProfile;
  tiles: TileCoord[];
  /** Fine samples planned; 0 means the coarse view already stands. */
  samples: number;
  sweep(src: DemSource): ViewProfile;
}

/** `sweepView` refined where the skyline could stand higher; see `planRefinement`. */
export function refineView(src: DemSource, plan: SweepPlan, eyeM: number, eyeAboveGroundM: number, rangeM: number, minStepDeg = 0.02, o: RefineOptions = {}): ViewRefinement {
  const r = planRefinement(src, plan, eyeM, o);
  const fallback = flatHorizonDeg(eyeAboveGroundM);
  const coarse = new Layers(plan.nAz, minStepDeg, fallback);
  for (let i = 0; i < plan.nAz; i++) {
    coarse.begin(i);
    for (let j = plan.start[i]; j < plan.start[i + 1]; j++) if (!Number.isNaN(r.angle[j])) coarse.add(r.angle[j], plan.distM[j]);
    coarse.end(i);
  }
  const f = r.fine;
  return {
    coarse: coarse.view(plan, rangeM),
    tiles: requiredTiles(f),
    samples: f.distM.length,
    sweep(src2) {
      const out = new Layers(plan.nAz, minStepDeg, fallback);
      for (let i = 0; i < plan.nAz; i++) {
        out.begin(i);
        // The coarse reads left standing and the fine stretches, merged in distance order.
        let j = plan.start[i];
        const j1 = plan.start[i + 1];
        for (let m = f.start[i]; m < f.start[i + 1]; m++) {
          for (; j < j1 && plan.distM[j] < f.distM[m]; j++) if (!r.refined[j] && !Number.isNaN(r.angle[j])) out.add(r.angle[j], plan.distM[j]);
          const g = elevationAt(src2, f.lng[m], f.lat[m], f.zoom[m]);
          if (!Number.isNaN(g)) out.add(elevationAngleDeg(f.distM[m], g - eyeM), f.distM[m]);
        }
        for (; j < j1; j++) if (!r.refined[j] && !Number.isNaN(r.angle[j])) out.add(r.angle[j], plan.distM[j]);
        out.end(i);
      }
      return out.view(plan, rangeM);
    }
  };
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
