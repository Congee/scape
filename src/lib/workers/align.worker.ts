/// <reference lib="webworker" />
import { alignAt, alignGrid, landmarkTopM, type Landmark } from '@core/align/alignment';
import { bodyVisibleGrid, ladderReachM, rayLadder, viewshedGrid } from '@core/align/visibility';
import { makeObserver } from '@core/astro/bodies';
import { skySample, type SkySample } from '@core/astro/fastHorizon';
import type { LngLat } from '@core/geo/geodesy';
import { cellSizeM, gridAround, gridBounds, type HeatGrid } from '@core/geo/grid';
import { elevationAt } from '@core/terrain/dem';
import { planSweep, requiredTiles } from '@core/terrain/horizon';
import { lngLatToTilePixel, metersPerPixel, tilesInBounds, zoomForResolution, type TileCoord } from '@core/terrain/tiles';
import { DemCache, POINT_ZOOM } from '@data/terrainTiles';
import { AlignRequestKind, AlignResponseKind, HeatMode, type AlignRequest, type AlignResponse, type HeatParams, type HeatRequest, type HeatResult, type PickRequest } from './align.protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
/** Grids of a few thousand cells read far more tiles than a single sweep does. */
const cache = new DemCache(400, 8);
/** Newest request id per kind; a pick must not cancel a running heat. */
const latest: Record<AlignRequestKind, number> = { Heat: 0, Pick: 0 };

/** Ray range for the Visible mode; beyond this no terrain can hide a body above the skyline. */
const VISIBLE_RANGE_M = 50_000;
/** Coarsest and finest tile zoom a heat grid reads. */
const MIN_ZOOM = 8;
const MAX_ZOOM = 13;
const SAMPLE_MIN_STEP_MS = 10_000;
const MAX_SAMPLES = 240;

const tileAt = (p: LngLat, z: number): TileCoord => {
  const t = lngLatToTilePixel(p.lng, p.lat, z);
  return { z, x: t.x, y: t.y };
};

interface Plan {
  grid: HeatGrid;
  cellM: number;
  zoom: number;
  samples: SkySample[];
}

function planFor(p: HeatParams): Plan {
  const grid = gridAround(p.centre, p.rangeM, p.cells);
  const cellM = cellSizeM(grid);
  const zoom = zoomForResolution(p.centre.lat, cellM / 2, MIN_ZOOM, MAX_ZOOM);
  const ref = makeObserver(p.centre, 0);
  const halfMs = p.windowMin * 60_000;
  const step = Math.max(SAMPLE_MIN_STEP_MS, (2 * halfMs) / MAX_SAMPLES);
  const samples: SkySample[] = [];
  for (let ms = p.timeMs - halfMs; ms <= p.timeMs + halfMs + 1e-6; ms += step) samples.push(skySample(p.body, ms, ref));
  return { grid, cellM, zoom, samples };
}

function needLandmark(p: HeatParams): Landmark {
  if (!p.landmark) throw new Error('Place a target location');
  return p.landmark;
}

const capFor = (toleranceDeg: number) => Math.max(4, 8 * toleranceDeg);

/** Tiles under the grid plus the landmark's, coarse and fine; the landmark may fall outside the grid. */
function alignTiles(plan: Plan, landmark: Landmark): TileCoord[] {
  return [...tilesInBounds(gridBounds(plan.grid, plan.cellM), plan.zoom), tileAt(landmark, plan.zoom), tileAt(landmark, POINT_ZOOM)];
}

/** A summit is hundreds of metres lower in a coarse tile, so single points read the finest tile that loaded. */
function pointZoomFor(p: LngLat, zoom: number): number {
  return Number.isNaN(elevationAt(cache, p.lng, p.lat, POINT_ZOOM)) ? zoom : POINT_ZOOM;
}

async function heat(req: HeatRequest): Promise<AlignResponse | null> {
  const t0 = performance.now();
  const plan = planFor(req);
  const { grid, zoom, samples } = plan;
  const fresh = () => latest.Heat === req.id;
  const result = (r: Omit<HeatResult, 'grid' | 'mode' | 'elapsedMs'>): AlignResponse => ({
    kind: AlignResponseKind.Heat,
    id: req.id,
    mode: req.mode,
    grid,
    elapsedMs: performance.now() - t0,
    ...r
  });

  if (req.mode === HeatMode.Align || req.mode === HeatMode.Time) {
    const landmark = needLandmark(req);
    await cache.loadAll(alignTiles(plan, landmark));
    if (!fresh()) return null;
    const capDeg = capFor(req.toleranceDeg);
    const topM = landmarkTopM(cache, pointZoomFor(landmark, zoom), landmark);
    const g = alignGrid(cache, zoom, grid, samples, req.timeMs, landmark, { eyeAboveGroundM: req.eyeAboveGroundM, offsetAzDeg: req.offsetAzDeg, offsetAltDeg: req.offsetAltDeg, capDeg }, topM);
    return result({ values: g.sepDeg, dtMs: g.dtMs, capDeg, landmarkGroundM: g.landmarkGroundM });
  }

  if (req.mode === HeatMode.Visible) {
    const ladder = rayLadder(req.centre.lat, VISIBLE_RANGE_M, { minZoom: MIN_ZOOM, maxZoom: Math.min(12, zoom), stepFraction: 0.02 });
    const tiles: TileCoord[] = [];
    for (const z of new Set(ladder.zoom)) tiles.push(...tilesInBounds(gridBounds(grid, ladderReachM(ladder, z)), z));
    await cache.loadAll(tiles);
    if (!fresh()) return null;
    const values = bodyVisibleGrid(cache, grid, skySample(req.body, req.timeMs, makeObserver(req.centre, 0)), ladder, { eyeAboveGroundM: req.eyeAboveGroundM, minAltAboveTerrainDeg: req.minAltAboveTerrainDeg });
    return result({ values, dtMs: null, capDeg: 1, landmarkGroundM: null });
  }

  // The sweep has to reach the grid corners.
  const sweep = planSweep(req.centre, req.rangeM * Math.SQRT2, { azStepDeg: 360 / (6 * req.cells), minDistM: 30, maxZoom: zoom, stepFraction: 0.01 });
  await cache.loadAll([...requiredTiles(sweep), tileAt(req.centre, zoom)]);
  if (!fresh()) return null;
  const g = elevationAt(cache, req.centre.lng, req.centre.lat, zoom);
  const eyeM = Math.max(Number.isNaN(g) ? 0 : g, 0) + req.eyeAboveGroundM;
  const values = viewshedGrid(cache, sweep, grid, eyeM);
  return result({ values, dtMs: null, capDeg: 1, landmarkGroundM: null });
}

async function pick(req: PickRequest): Promise<AlignResponse | null> {
  const landmark = needLandmark(req);
  const plan = planFor(req);
  const { cellM, zoom, samples } = plan;
  // The sightline crosses everything between the point and the landmark.
  const a = lngLatToTilePixel(req.point.lng, req.point.lat, 0, 1);
  const b = lngLatToTilePixel(landmark.lng, landmark.lat, 0, 1);
  const m = cellM / metersPerPixel(req.point.lat, 0, 1);
  await cache.loadAll([...tilesInBounds({ x0: Math.min(a.px, b.px) - m, x1: Math.max(a.px, b.px) + m, y0: Math.min(a.py, b.py) - m, y1: Math.max(a.py, b.py) + m }, zoom), tileAt(req.point, POINT_ZOOM), tileAt(landmark, POINT_ZOOM)]);
  if (latest.Pick !== req.id) return null;
  const o = { eyeAboveGroundM: req.eyeAboveGroundM, offsetAzDeg: req.offsetAzDeg, offsetAltDeg: req.offsetAltDeg, capDeg: capFor(req.toleranceDeg) };
  const topM = landmarkTopM(cache, pointZoomFor(landmark, zoom), landmark);
  const p = alignAt(cache, zoom, req.point, samples, landmark, topM, o, cellM, pointZoomFor(req.point, zoom));
  return { kind: AlignResponseKind.Pick, id: req.id, point: p && { ...p, lng: req.point.lng, lat: req.point.lat } };
}

scope.addEventListener('message', (e: MessageEvent<AlignRequest>) => {
  const req = e.data;
  latest[req.kind] = req.id;
  const work = req.kind === AlignRequestKind.Heat ? heat(req) : pick(req);
  work.then(
    (res) => {
      if (res) scope.postMessage(res);
    },
    (err: unknown) => {
      if (latest[req.kind] !== req.id) return;
      const message = err instanceof Error ? err.message : String(err);
      scope.postMessage({ kind: AlignResponseKind.Error, id: req.id, message } satisfies AlignResponse);
    }
  );
});
