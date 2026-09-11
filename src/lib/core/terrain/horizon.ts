import { destination, elevationAngleDeg, type LngLat } from '@core/geo/geodesy';
import { elevationAt, type DemSource } from './dem';
import { flatHorizonDeg } from './los';
import { lngLatToTilePixel, metersPerPixel, zoomForResolution, type TileCoord } from './tiles';

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
  /** Sample spacing as a fraction of distance; sets the zoom ladder (0.0045 ≈ 0.15° on a 30° slope). */
  stepFraction?: number;
}

export function planSweep(pin: LngLat, rangeM: number, o: SweepOptions = {}): SweepPlan {
  const azStepDeg = o.azStepDeg ?? 0.5;
  const nAz = Math.round(360 / azStepDeg);
  const minD = o.minDistM ?? 50;
  const minZ = o.minZoom ?? 8;
  const maxZ = o.maxZoom ?? 14;
  const frac = o.stepFraction ?? 0.0045;

  // One distance ladder for every azimuth: steps grow with distance as coarser zooms take over.
  const dists: number[] = [];
  const zooms: number[] = [];
  for (let d = minD; d <= rangeM; ) {
    const z = zoomForResolution(pin.lat, frac * d, minZ, maxZ);
    dists.push(d);
    zooms.push(z);
    d += metersPerPixel(pin.lat, z);
  }
  const perAz = dists.length;
  const total = nAz * perAz;
  const plan: SweepPlan = {
    nAz,
    azStepDeg,
    start: new Int32Array(nAz + 1),
    lng: new Float32Array(total),
    lat: new Float32Array(total),
    distM: new Float32Array(total),
    zoom: new Uint8Array(total)
  };
  for (let i = 0; i < nAz; i++) {
    const az = i * azStepDeg;
    const base = i * perAz;
    plan.start[i] = base;
    for (let j = 0; j < perAz; j++) {
      const p = destination(pin, az, dists[j]);
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
 * Ground below sea level counts as sea surface, so sea views come out at the sea horizon.
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
      const a = elevationAngleDeg(plan.distM[j], Math.max(g, 0) - eyeM);
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
