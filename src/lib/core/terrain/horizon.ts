import { elevationAngleDeg, type LngLat } from '@core/geo/geodesy';
import { pinFrame } from '@core/geo/pinFrame';
import { elevationAt, type DemSource } from './dem';
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
  nAz: number;
  azStepDeg: number;
  /** Azimuth of column 0; columns run clockwise. */
  azFromDeg: number;
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
    nAz,
    azStepDeg,
    azFromDeg,
    start: new Int32Array(nAz + 1),
    lng: new Float32Array(total),
    lat: new Float32Array(total),
    distM: new Float32Array(total),
    zoom: new Uint8Array(total)
  };
  // Rays in the pin's ENU frame, like the mesh posts, so the skyline sits where the mesh draws it.
  const frame = pinFrame(pin);
  for (let i = 0; i < nAz; i++) {
    const az = ((cols ? cols[i] * azStepDeg : azFromDeg + i * azStepDeg) * Math.PI) / 180;
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

/**
 * Radial sweep: per azimuth, the highest elevation angle of any terrain sample along the ray.
 * `eyeM` is the eye's absolute height; `eyeAboveGroundM` sets the fallback dip where nothing was sampled.
 */
export function sweepHorizon(src: DemSource, plan: SweepPlan, eyeM: number, eyeAboveGroundM: number, rangeM: number): HorizonProfile {
  const angleDeg = new Float32Array(plan.nAz);
  const distM = new Float32Array(plan.nAz);
  const fallback = flatHorizonDeg(eyeAboveGroundM);
  for (let i = 0; i < plan.nAz; i++) {
    let best = -Infinity;
    let bestD = 0;
    for (let j = plan.start[i]; j < plan.start[i + 1]; j++) {
      const g = elevationAt(src, plan.lng[j], plan.lat[j], plan.zoom[j]);
      if (Number.isNaN(g)) continue;
      const a = elevationAngleDeg(plan.distM[j], g - eyeM);
      if (a > best) {
        best = a;
        bestD = plan.distM[j];
      }
    }
    angleDeg[i] = best === -Infinity ? fallback : best;
    distM[i] = bestD;
  }
  return { azStepDeg: plan.azStepDeg, angleDeg, distM, rangeM };
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
