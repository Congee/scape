import { horizontalFast, separationDeg, type SkySample } from '@core/astro/fastHorizon';
import { airDensity } from '@core/astro/refraction';
import { bearingDeg, distanceM, elevationAngleDeg, geodesicBetween, normalizeLng, type LngLat } from '@core/geo/geodesy';
import { cellCentre, cellSizeM, type HeatGrid } from '@core/geo/grid';
import { elevationAt, type DemSource } from '@core/terrain/dem';

export interface Landmark extends LngLat {
  /** Height of the landmark's top above its ground, metres. */
  heightM: number;
}

export interface AlignOptions {
  eyeAboveGroundM: number;
  /** Where the body should stand relative to the landmark top: right and up are positive. */
  offsetAzDeg: number;
  offsetAltDeg: number;
  /** Separations beyond this are not reported. */
  capDeg: number;
}

export interface AlignGridResult {
  /** Smallest separation between the body and the wanted direction during the window, degrees; NaN where unknown, blocked or beyond the cap. */
  sepDeg: Float32Array;
  /** Offset of that moment from the window centre, milliseconds. */
  dtMs: Float32Array;
  landmarkGroundM: number;
}

export interface AlignPoint {
  groundM: number;
  eyeM: number;
  distM: number;
  bearingDeg: number;
  landmarkAngleDeg: number;
  sepDeg: number;
  bestMs: number;
  blocked: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Terrain between the eye and the target rises above the sightline; samples within `skipM` of either end are ignored. */
export function sightlineBlocked(src: DemSource, zoom: number, from: LngLat, to: LngLat, eyeM: number, targetAngleDeg: number, distM: number, skipM: number, samples: number): boolean {
  const along = geodesicBetween(from, to);
  for (let k = 1; k < samples; k++) {
    const d = (distM * k) / samples;
    if (d < skipM || d > distM - skipM) continue;
    const p = along(k / samples);
    const g = elevationAt(src, normalizeLng(p.lng), p.lat, zoom);
    if (Number.isNaN(g)) continue;
    if (elevationAngleDeg(d, g - eyeM) > targetAngleDeg) return true;
  }
  return false;
}

export function landmarkTopM(src: DemSource, zoom: number, l: Landmark): number {
  const g = elevationAt(src, l.lng, l.lat, zoom);
  return (Number.isNaN(g) ? 0 : g) + l.heightM;
}

function closest(samples: SkySample[], lat: number, lng: number, eyeM: number, azDeg: number, altDeg: number): { sepDeg: number; ms: number } {
  const density = airDensity(eyeM);
  let sepDeg = Infinity;
  let ms = samples[0]?.ms ?? 0;
  for (const s of samples) {
    const h = horizontalFast(s, lat, lng, density);
    const sep = separationDeg(h.azimuth, h.altitude, azDeg, altDeg);
    if (sep < sepDeg) {
      sepDeg = sep;
      ms = s.ms;
    }
  }
  return { sepDeg, ms };
}

/** Full evaluation of one candidate camera position. */
export function alignAt(src: DemSource, zoom: number, p: LngLat, samples: SkySample[], landmark: Landmark, topM: number, o: AlignOptions, cellM: number, pointZoom = zoom): AlignPoint | null {
  const g = elevationAt(src, p.lng, p.lat, pointZoom);
  if (Number.isNaN(g)) return null;
  const distM = distanceM(p, landmark);
  if (distM < cellM) return null;
  const eyeM = g + o.eyeAboveGroundM;
  const brg = bearingDeg(p, landmark);
  const angle = elevationAngleDeg(distM, topM - eyeM);
  const c = closest(samples, p.lat, p.lng, eyeM, brg + o.offsetAzDeg, angle + o.offsetAltDeg);
  const n = clamp(Math.round(distM / (cellM / 2)), 4, 160);
  return { groundM: g, eyeM, distM, bearingDeg: brg, landmarkAngleDeg: angle, sepDeg: c.sepDeg, bestMs: c.ms, blocked: sightlineBlocked(src, zoom, p, landmark, eyeM, angle, distM, cellM, n) };
}

/**
 * For every cell, how close the body comes to the wanted direction of the landmark during
 * the sampled window, and when; cells whose sightline to the landmark is blocked are dropped.
 */
export function alignGrid(src: DemSource, zoom: number, grid: HeatGrid, samples: SkySample[], centreMs: number, landmark: Landmark, o: AlignOptions, topM = landmarkTopM(src, zoom, landmark)): AlignGridResult {
  const n = grid.n;
  const sepDeg = new Float32Array(n * n).fill(NaN);
  const dtMs = new Float32Array(n * n).fill(NaN);
  const cellM = cellSizeM(grid);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const p = cellCentre(grid, row, col);
      const g = elevationAt(src, p.lng, p.lat, zoom);
      if (Number.isNaN(g)) continue;
      const distM = distanceM(p, landmark);
      if (distM < cellM) continue;
      const eyeM = g + o.eyeAboveGroundM;
      const angle = elevationAngleDeg(distM, topM - eyeM);
      const c = closest(samples, p.lat, p.lng, eyeM, bearingDeg(p, landmark) + o.offsetAzDeg, angle + o.offsetAltDeg);
      if (c.sepDeg > o.capDeg) continue;
      const steps = clamp(Math.round(distM / (cellM / 2)), 4, 160);
      if (sightlineBlocked(src, zoom, p, landmark, eyeM, angle, distM, cellM, steps)) continue;
      const i = row * n + col;
      sepDeg[i] = c.sepDeg;
      dtMs[i] = c.ms - centreMs;
    }
  }
  return { sepDeg, dtMs, landmarkGroundM: topM - landmark.heightM };
}
