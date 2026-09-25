import { curvatureDropM, elevationAngleDeg, type LngLat } from '@core/geo/geodesy';
import { pinFrame } from '@core/geo/pinFrame';
import { elevationAt, type DemSource, type DemTile } from './dem';
import { flatHorizonDeg } from './los';
import { lngLatToTilePixel, metersPerPixel, TILE_SIZE, zoomForResolution, type TileCoord } from './tiles';

/** Terrain horizon around an observer: elevation angle of the skyline per azimuth. */
export interface HorizonProfile {
  azStepDeg: number;
  /** Index i is azimuth i * azStepDeg, degrees clockwise from north. */
  angleDeg: Float32Array;
  /** Distance of the skyline point per azimuth, metres (0 where no terrain was sampled). */
  distM: Float32Array;
  rangeM: number;
}

/** Pre-computed sample positions for a radial sweep; shared by the tile-collection and sampling passes. */
export interface SweepPlan {
  pin: LngLat;
  nAz: number;
  azStepDeg: number;
  /** Azimuth of column 0; columns run clockwise. */
  azFromDeg: number;
  /** Azimuth of each column, degrees. */
  azDeg: Float64Array;
  /** Samples for azimuth i are [start[i], start[i + 1]). */
  start: Int32Array;
  lng: Float32Array;
  lat: Float32Array;
  distM: Float32Array;
  zoom: Uint8Array;
}

export interface SweepOptions {
  azStepDeg?: number;
  /** Nearest sample; the DEM cannot resolve terrain closer than a pixel or two. */
  minDistM?: number;
  minZoom?: number;
  maxZoom?: number;
  /** Post count of the DEM tiles the zooms refer to; the ladder's ground steps depend on it. */
  tileSize?: number;
  /** Sample spacing as a fraction of distance; sets the zoom ladder (0.0045 ≈ 0.15° on a 30° slope). */
  stepFraction?: number;
  /** Azimuth window; defaults to the full circle. */
  azFromDeg?: number;
  azSpanDeg?: number;
  /** Grid columns to plan instead of the window, each at index × azStepDeg; ascending. */
  columns?: ArrayLike<number>;
}

/** Columns a window of `spanDeg` holds at `stepDeg`; a full circle does not repeat its first. */
export function sweepColumns(spanDeg: number, stepDeg: number): number {
  return spanDeg >= 360 ? Math.round(360 / stepDeg) : Math.floor(spanDeg / stepDeg + 1e-9) + 1;
}

export function planSweep(pin: LngLat, rangeM: number, o: SweepOptions = {}): SweepPlan {
  const azStepDeg = o.azStepDeg ?? 0.5;
  const cols = o.columns;
  const azFromDeg = cols ? (cols.length > 0 ? cols[0] * azStepDeg : 0) : (o.azFromDeg ?? 0);
  const nAz = cols ? cols.length : sweepColumns(o.azSpanDeg ?? 360, azStepDeg);
  const minD = o.minDistM ?? 50;
  const minZ = o.minZoom ?? 8;
  const maxZ = o.maxZoom ?? 14;
  const frac = o.stepFraction ?? 0.0045;
  const size = o.tileSize ?? TILE_SIZE;

  // One distance ladder for every azimuth: steps grow with distance as coarser zooms take over.
  const dists: number[] = [];
  const zooms: number[] = [];
  for (let d = minD; d <= rangeM; ) {
    const z = zoomForResolution(pin.lat, frac * d, minZ, maxZ, size);
    dists.push(d);
    zooms.push(z);
    d += metersPerPixel(pin.lat, z, size);
  }
  const perAz = dists.length;
  const total = nAz * perAz;
  const plan: SweepPlan = {
    pin,
    nAz,
    azStepDeg,
    azFromDeg,
    azDeg: new Float64Array(nAz),
    start: new Int32Array(nAz + 1),
    lng: new Float32Array(total),
    lat: new Float32Array(total),
    distM: new Float32Array(total),
    zoom: new Uint8Array(total)
  };
  // Rays in the pin's ENU frame, like the mesh posts, so the skyline sits where the mesh draws it.
  const frame = pinFrame(pin);
  for (let i = 0; i < nAz; i++) {
    plan.azDeg[i] = cols ? cols[i] * azStepDeg : azFromDeg + i * azStepDeg;
    const az = (plan.azDeg[i] * Math.PI) / 180;
    const se = Math.sin(az);
    const cn = Math.cos(az);
    const base = i * perAz;
    plan.start[i] = base;
    for (let j = 0; j < perAz; j++) {
      const p = frame.fromEn(dists[j] * se, dists[j] * cn);
      plan.lng[base + j] = p.lng;
      plan.lat[base + j] = p.lat;
      plan.distM[base + j] = dists[j];
      plan.zoom[base + j] = zooms[j];
    }
  }
  plan.start[nAz] = total;
  return plan;
}

/** Distinct tiles a sweep will read. */
export function requiredTiles(plan: SweepPlan): TileCoord[] {
  const seen = new Set<number>();
  const out: TileCoord[] = [];
  let last = -1;
  for (let i = 0; i < plan.lng.length; i++) {
    const t = lngLatToTilePixel(plan.lng[i], plan.lat[i], plan.zoom[i]);
    const key = (t.z * 32768 + t.x) * 32768 + t.y;
    if (key === last) continue;
    last = key;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ z: t.z, x: t.x, y: t.y });
  }
  return out;
}

/** Per column of `plan`, the highest elevation angle sampled and its distance; -Infinity where nothing was read. */
function sweepMax(src: DemSource, plan: SweepPlan, eyeM: number): { best: Float64Array; bestD: Float32Array } {
  const best = new Float64Array(plan.nAz).fill(-Infinity);
  const bestD = new Float32Array(plan.nAz);
  for (let i = 0; i < plan.nAz; i++)
    for (let j = plan.start[i]; j < plan.start[i + 1]; j++) {
      const g = elevationAt(src, plan.lng[j], plan.lat[j], plan.zoom[j]);
      if (Number.isNaN(g)) continue;
      const a = elevationAngleDeg(plan.distM[j], g - eyeM);
      if (a > best[i]) {
        best[i] = a;
        bestD[i] = plan.distM[j];
      }
    }
  return { best, bestD };
}

function toProfile(plan: SweepPlan, best: Float64Array, bestD: Float32Array, eyeAboveGroundM: number, rangeM: number): HorizonProfile {
  const fallback = flatHorizonDeg(eyeAboveGroundM);
  const angleDeg = Float32Array.from(best, (a) => (a === -Infinity ? fallback : a));
  return { azStepDeg: plan.azStepDeg, angleDeg, distM: bestD, rangeM };
}

/**
 * Radial sweep: per azimuth, the highest elevation angle of any terrain sample along the ray.
 * `eyeM` is the eye's absolute height; `eyeAboveGroundM` sets the fallback dip where nothing was sampled.
 */
export function sweepHorizon(src: DemSource, plan: SweepPlan, eyeM: number, eyeAboveGroundM: number, rangeM: number): HorizonProfile {
  const { best, bestD } = sweepMax(src, plan, eyeM);
  return toProfile(plan, best, bestD, eyeAboveGroundM, rangeM);
}

export interface RefineOptions {
  minZoom?: number;
  /** Finest zoom a refined stretch reads. */
  maxZoom?: number;
  tileSize?: number;
  /** Refined cell as a fraction of distance. */
  stepFraction?: number;
  /** How far fine terrain may stand above a coarse cell's highest post, as a multiple of that cell's post range. */
  reliefFactor?: number;
  /** Skyline error accepted rather than refined, degrees: a bound that clears the coarse skyline by no more is left alone. */
  toleranceDeg?: number;
}

/** A horizon sweep with a second, finer pass: the coarse skyline, the fine tiles it needs, and the refined skyline once they are loaded. */
export interface Refinement {
  coarse: HorizonProfile;
  tiles: TileCoord[];
  /** Fine samples planned; 0 means the coarse skyline already stands. */
  samples: number;
  sweep(src: DemSource): HorizonProfile;
}

/**
 * Coarse zooms average a summit away, so the skyline reads low by up to a cell's relief. The coarse sweep
 * also bounds the fine ground under each sample (highest post of its cell plus a multiple of the cell's post
 * range); every sample whose bound could still reach the coarse skyline is re-marched at a finer zoom, and
 * the rest, which cannot set the skyline, keep their coarse read. `plan` must come from `planSweep`.
 */
export function refineHorizon(src: DemSource, plan: SweepPlan, eyeM: number, eyeAboveGroundM: number, rangeM: number, o: RefineOptions = {}): Refinement {
  const minZ = o.minZoom ?? 8;
  const maxZ = o.maxZoom ?? 15;
  const size = o.tileSize ?? TILE_SIZE;
  const frac = o.stepFraction ?? 0.0005;
  const relief = o.reliefFactor ?? 1;
  const tolDeg = o.toleranceDeg ?? 0.001;
  const n = plan.distM.length;
  const angle = new Float32Array(n).fill(NaN);
  const bound = new Float32Array(n);
  const best = new Float64Array(plan.nAz).fill(-Infinity);
  const bestD = new Float32Array(plan.nAz);
  for (let i = 0; i < plan.nAz; i++)
    for (let j = plan.start[i]; j < plan.start[i + 1]; j++) {
      const t = lngLatToTilePixel(plan.lng[j], plan.lat[j], plan.zoom[j], 1);
      const tile = src.get(t.z, t.x, t.y);
      if (!tile) continue;
      cellBound(tile, t.px * tile.size, t.py * tile.size, relief);
      const a = elevationAngleDeg(plan.distM[j], cell.g - eyeM);
      angle[j] = a;
      bound[j] = cell.hi;
      if (a > best[i]) {
        best[i] = a;
        bestD[i] = plan.distM[j];
      }
    }
  const coarse = toProfile(plan, best, bestD, eyeAboveGroundM, rangeM);

  // planSweep gives every column the same distance ladder, so the fine zoom per rung is shared.
  const rungs = plan.nAz ? plan.start[1] - plan.start[0] : 0;
  const fineZ = new Uint8Array(rungs);
  const drop = new Float64Array(rungs);
  for (let k = 0; k < rungs; k++) {
    fineZ[k] = zoomForResolution(plan.pin.lat, frac * plan.distM[k], minZ, maxZ, size);
    drop[k] = curvatureDropM(plan.distM[k]);
  }
  const lng: number[] = [];
  const lat: number[] = [];
  const dist: number[] = [];
  const zoom: number[] = [];
  const start = new Int32Array(plan.nAz + 1);
  const rest = new Float64Array(plan.nAz).fill(-Infinity);
  const restD = new Float32Array(plan.nAz);
  const frame = pinFrame(plan.pin);
  for (let i = 0; i < plan.nAz; i++) {
    start[i] = dist.length;
    const j0 = plan.start[i];
    const j1 = plan.start[i + 1];
    const tanFloor = Math.tan(((best[i] + tolDeg) * Math.PI) / 180);
    const az = (plan.azDeg[i] * Math.PI) / 180;
    const se = Math.sin(az);
    const cn = Math.cos(az);
    // Fine stretches already planned reach this far, so overlapping neighbours are not marched twice.
    let reach = -Infinity;
    for (let j = j0, k = 0; j < j1; j++, k++) {
      if (Number.isNaN(angle[j])) continue;
      if (fineZ[k] <= plan.zoom[j] || bound[j] < eyeM + plan.distM[j] * tanFloor + drop[k]) {
        if (angle[j] > rest[i]) {
          rest[i] = angle[j];
          restD[i] = plan.distM[j];
        }
        continue;
      }
      // The stretch between this sample's neighbours: the ground its bilinear read blends.
      let d = Math.max(reach, plan.distM[Math.max(j - 1, j0)]);
      const d1 = plan.distM[Math.min(j + 1, j1 - 1)];
      while (d <= d1) {
        const z = Math.max(plan.zoom[j], zoomForResolution(plan.pin.lat, frac * d, minZ, maxZ, size));
        const p = frame.fromEn(d * se, d * cn);
        lng.push(p.lng);
        lat.push(p.lat);
        dist.push(d);
        zoom.push(z);
        d += metersPerPixel(plan.pin.lat, z, size);
      }
      reach = d;
    }
  }
  start[plan.nAz] = dist.length;
  const fine: SweepPlan = { ...plan, start, lng: Float32Array.from(lng), lat: Float32Array.from(lat), distM: Float32Array.from(dist), zoom: Uint8Array.from(zoom) };
  return {
    coarse,
    tiles: requiredTiles(fine),
    samples: dist.length,
    sweep(src2) {
      const f = sweepMax(src2, fine, eyeM);
      for (let i = 0; i < plan.nAz; i++)
        if (rest[i] > f.best[i]) {
          f.best[i] = rest[i];
          f.bestD[i] = restD[i];
        }
      return toProfile(plan, f.best, f.bestD, eyeAboveGroundM, rangeM);
    }
  };
}

const cell = { g: 0, hi: 0 };

/** Bilinear read into `cell.g`, and into `cell.hi` a bound on the fine ground under it: highest post plus `relief` times the post range. */
function cellBound(t: DemTile, px: number, py: number, relief: number): void {
  const s = t.size;
  const fx = Math.min(Math.max(px - 0.5, 0), s - 1);
  const fy = Math.min(Math.max(py - 0.5, 0), s - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, s - 1);
  const y1 = Math.min(y0 + 1, s - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const e = t.elev;
  const p00 = e[y0 * s + x0];
  const p10 = e[y0 * s + x1];
  const p01 = e[y1 * s + x0];
  const p11 = e[y1 * s + x1];
  const hi = Math.max(p00, p10, p01, p11);
  cell.g = (p00 * (1 - tx) + p10 * tx) * (1 - ty) + (p01 * (1 - tx) + p11 * tx) * ty;
  cell.hi = hi + relief * (hi - Math.min(p00, p10, p01, p11));
}

/** Horizon elevation angle at any azimuth, linearly interpolated with wrap-around. */
export function horizonAngleAt(h: HorizonProfile, azimuthDeg: number): number {
  const n = h.angleDeg.length;
  const f = (((azimuthDeg % 360) + 360) % 360) / h.azStepDeg;
  const i0 = Math.floor(f) % n;
  const i1 = (i0 + 1) % n;
  const t = f - Math.floor(f);
  return h.angleDeg[i0] * (1 - t) + h.angleDeg[i1] * t;
}
