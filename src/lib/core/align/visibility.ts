import { horizontalFast, type SkySample } from '@core/astro/fastHorizon';
import { elevationAngleDeg, type LngLat } from '@core/geo/geodesy';
import { frameAt } from '@core/geo/pinFrame';
import { cellCentre, cellOf, type HeatGrid } from '@core/geo/grid';
import { elevationAt, type DemSource } from '@core/terrain/dem';
import type { SweepPlan } from '@core/terrain/horizon';
import { flatHorizonDeg } from '@core/terrain/los';
import { metersPerPixel, TILE_SIZE, zoomForResolution } from '@core/terrain/tiles';

const D2R = Math.PI / 180;
/** No terrain on Earth stands higher; rays stop once even that could not reach the body. */
const MAX_TERRAIN_M = 9000;

/** Distances and zooms for a ray march; steps grow with distance so far ground stays coarse. */
export interface RayLadder {
  distM: Float64Array;
  zoom: Uint8Array;
}

export interface LadderOptions {
  minDistM?: number;
  minZoom: number;
  maxZoom: number;
  /** Post count of the DEM tiles the zooms refer to; the ladder's ground steps depend on it. */
  tileSize?: number;
  /** Step as a fraction of the distance once the finest zoom is left behind. */
  stepFraction: number;
}

export function rayLadder(latDeg: number, rangeM: number, o: LadderOptions): RayLadder {
  const dists: number[] = [];
  const zooms: number[] = [];
  const size = o.tileSize ?? TILE_SIZE;
  for (let d = o.minDistM ?? 40; d <= rangeM; ) {
    const z = zoomForResolution(latDeg, o.stepFraction * d, o.minZoom, o.maxZoom, size);
    dists.push(d);
    zooms.push(z);
    d += Math.max(metersPerPixel(latDeg, z, size), o.stepFraction * d);
  }
  return { distM: Float64Array.from(dists), zoom: Uint8Array.from(zooms) };
}

/** Farthest sample distance that still reads zoom `z` (0 when the ladder never uses it). */
export function ladderReachM(l: RayLadder, z: number): number {
  let reach = 0;
  for (let i = 0; i < l.zoom.length; i++) if (l.zoom[i] === z) reach = l.distM[i];
  return reach;
}

/** Terrain along the ray from `from` rises above `altDeg`, walked in the eye's ENU frame like the viewfinder mesh. */
export function rayBlocked(src: DemSource, ladder: RayLadder, from: LngLat, azDeg: number, eyeM: number, altDeg: number): boolean {
  const frame = frameAt(from);
  const se = Math.sin(azDeg * D2R);
  const cn = Math.cos(azDeg * D2R);
  for (let i = 0; i < ladder.distM.length; i++) {
    const d = ladder.distM[i];
    if (elevationAngleDeg(d, MAX_TERRAIN_M - eyeM) < altDeg) return false;
    const p = frame.fromEn(d * se, d * cn);
    const g = elevationAt(src, p.lng, p.lat, ladder.zoom[i]);
    if (Number.isNaN(g)) continue;
    if (elevationAngleDeg(d, g - eyeM) > altDeg) return true;
  }
  return false;
}

export interface VisibleOptions {
  eyeAboveGroundM: number;
  /** The body must stand at least this far above the terrain skyline, degrees. */
  minAltAboveTerrainDeg: number;
}

/** 1 where the body clears the terrain from the cell, 0 where it is hidden, NaN without elevation data. */
export function bodyVisibleGrid(src: DemSource, grid: HeatGrid, sample: SkySample, ladder: RayLadder, o: VisibleOptions): Float32Array {
  const n = grid.n;
  const out = new Float32Array(n * n).fill(NaN);
  const zoomNear = ladder.zoom[0];
  const dip = flatHorizonDeg(o.eyeAboveGroundM);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const p = cellCentre(grid, row, col);
      const g = elevationAt(src, p.lng, p.lat, zoomNear);
      if (Number.isNaN(g)) continue;
      const h = horizontalFast(sample, p.lat, p.lng);
      const margin = h.altitude - o.minAltAboveTerrainDeg;
      const i = row * n + col;
      if (margin < dip) {
        out[i] = 0;
        continue;
      }
      out[i] = rayBlocked(src, ladder, p, h.azimuth, g + o.eyeAboveGroundM, margin) ? 0 : 1;
    }
  }
  return out;
}

/** Ground visible from the eye: 1 where a swept sample in the cell is seen, 0 where all are hidden, NaN where none fell. */
export function viewshedGrid(src: DemSource, plan: SweepPlan, grid: HeatGrid, eyeM: number): Float32Array {
  const out = new Float32Array(grid.n * grid.n).fill(NaN);
  for (let i = 0; i < plan.nAz; i++) {
    let running = -90;
    for (let j = plan.start[i]; j < plan.start[i + 1]; j++) {
      const lng = plan.lng[j];
      const lat = plan.lat[j];
      const g = elevationAt(src, lng, lat, plan.zoom[j]);
      if (Number.isNaN(g)) continue;
      const a = elevationAngleDeg(plan.distM[j], g - eyeM);
      const cell = cellOf(grid, { lng, lat });
      if (cell) {
        const k = cell.row * grid.n + cell.col;
        if (a >= running - 1e-9) out[k] = 1;
        else if (Number.isNaN(out[k])) out[k] = 0;
      }
      if (a > running) running = a;
    }
  }
  return out;
}
