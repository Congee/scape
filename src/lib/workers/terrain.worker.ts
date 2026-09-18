/// <reference lib="webworker" />
import { bearingDeg, distanceM, intermediatePoint, type LngLat } from '@core/geo/geodesy';
import { cubicStencilTiles, elevationAt, elevationAtCubic } from '@core/terrain/dem';
import { buildHeightBound } from '@core/terrain/heightBound';
import { blockUnitBounds, BLOCKS_PER_SIDE, blockSideM, buildLevel, enuBoxUnitBounds, levelCellM, levelsForRange, MESH_MIN_CELL_M, selectBlocks } from '@core/terrain/mesh';
import { planSweep, requiredTiles, sweepHorizon } from '@core/terrain/horizon';
import { analyzeSightline } from '@core/terrain/los';
import { sweepView } from '@core/terrain/view';
import { lngLatToTilePixel, metersPerPixel, tileKey, tilesInBounds, zoomForResolution, type TileCoord } from '@core/terrain/tiles';
import { demCacheTiles, demZoom, DemCache, TERRAIN_MAX_ZOOM, TERRAIN_TILE_SIZE } from '@data/terrainTiles';
import { TerrainKind, type ElevationRequest, type HorizonRequest, type MeshRequest, type PointsRequest, type ProfileRequest, type TerrainRequest, type TerrainResponse, type ViewRequest } from './terrain.protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const cache = new DemCache(demCacheTiles(220));
/** Newest request id per kind; older ones stop before the expensive step. */
const latest: Record<TerrainKind, number> = { Elevation: 0, Profile: 0, Horizon: 0, View: 0, Points: 0, Mesh: 0 };

function tileAt(p: LngLat, z: number): TileCoord {
  const t = lngLatToTilePixel(p.lng, p.lat, z);
  return { z, x: t.x, y: t.y };
}

/** The surface the mesh draws, so the eye and anything standing on the ground share it. */
async function groundAt(p: LngLat): Promise<number> {
  await cache.loadAll(cubicStencilTiles(p.lng, p.lat, TERRAIN_MAX_ZOOM, TERRAIN_TILE_SIZE));
  return elevationAtCubic(cache, p.lng, p.lat, TERRAIN_MAX_ZOOM);
}

async function elevation(req: ElevationRequest | PointsRequest): Promise<TerrainResponse> {
  const tiles = new Map<string, TileCoord>();
  for (const p of req.points) for (const t of cubicStencilTiles(p.lng, p.lat, TERRAIN_MAX_ZOOM, TERRAIN_TILE_SIZE)) tiles.set(tileKey(t.z, t.x, t.y), t);
  await cache.loadAll([...tiles.values()]);
  const elevations = req.points.map((p) => elevationAtCubic(cache, p.lng, p.lat, TERRAIN_MAX_ZOOM));
  return { kind: req.kind, id: req.id, elevations };
}

async function profile(req: ProfileRequest): Promise<TerrainResponse | null> {
  const { a, b, samples: n } = req;
  const totalM = distanceM(a, b);
  const zoom = zoomForResolution((a.lat + b.lat) / 2, Math.max(1, totalM / n), demZoom(6), demZoom(14), TERRAIN_TILE_SIZE);
  const lng = new Float32Array(n);
  const lat = new Float32Array(n);
  const distM = new Float32Array(n);
  const tiles = new Map<string, TileCoord>();
  for (let i = 0; i < n; i++) {
    const p = intermediatePoint(a, b, i / (n - 1));
    lng[i] = p.lng;
    lat[i] = p.lat;
    distM[i] = (totalM * i) / (n - 1);
    const t = tileAt(p, zoom);
    tiles.set(tileKey(t.z, t.x, t.y), t);
  }
  await cache.loadAll([...tiles.values()]);
  if (latest.Profile !== req.id) return null;

  const groundM = new Float32Array(n);
  let missing = 0;
  for (let i = 0; i < n; i++) {
    groundM[i] = elevationAt(cache, lng[i], lat[i], zoom);
    if (Number.isNaN(groundM[i])) missing++;
  }
  // Endpoints come from the same zoom as the path so their own cells cannot "block" them.
  const groundA = Number.isNaN(groundM[0]) ? 0 : groundM[0];
  const groundB = Number.isNaN(groundM[n - 1]) ? 0 : groundM[n - 1];
  // Water reads as bathymetry in Terrarium; sightlines skim the surface instead.
  const eyeM = Math.max(groundA, 0) + req.eyeAboveGroundM;
  const targetM = Math.max(groundB, 0) + req.targetAboveGroundM;
  const cellM = metersPerPixel((a.lat + b.lat) / 2, zoom);
  const los = analyzeSightline(distM, groundM.map((g) => (Number.isNaN(g) ? g : Math.max(g, 0))), eyeM, targetM, cellM);
  return {
    kind: TerrainKind.Profile,
    id: req.id,
    result: { a, b, totalM, bearingDeg: bearingDeg(a, b), backBearingDeg: bearingDeg(b, a), zoom, distM, groundM, lng, lat, groundA, groundB, eyeM, targetM, los, missing }
  };
}

async function horizon(req: HorizonRequest): Promise<TerrainResponse | null> {
  const g = await groundAt(req.pin);
  const groundM = Number.isNaN(g) ? 0 : g;
  const plan = planSweep(req.pin, req.rangeM, { azStepDeg: req.azStepDeg, minZoom: demZoom(8), maxZoom: demZoom(14), tileSize: TERRAIN_TILE_SIZE });
  const tiles = requiredTiles(plan);
  await cache.loadAll(tiles);
  if (latest.Horizon !== req.id) return null;
  const eyeM = Math.max(groundM, 0) + req.eyeAboveGroundM;
  const skyline = sweepHorizon(cache, plan, eyeM, req.eyeAboveGroundM, req.rangeM);
  const missing = tiles.filter((t) => !cache.get(t.z, t.x, t.y)).length;
  return { kind: TerrainKind.Horizon, id: req.id, result: { profile: skyline, groundM, eyeM, tiles: tiles.length, missing } };
}

/** Finer and closer than the horizon sweep: the viewfinder shows the near ground too. */
async function view(req: ViewRequest): Promise<TerrainResponse | null> {
  const g = await groundAt(req.pin);
  const groundM = Number.isNaN(g) ? 0 : g;
  const plan = planSweep(req.pin, req.rangeM, { azStepDeg: req.azStepDeg, azFromDeg: req.azFromDeg, azSpanDeg: req.azSpanDeg, minDistM: 20, minZoom: demZoom(8), maxZoom: demZoom(15), tileSize: TERRAIN_TILE_SIZE });
  const tiles = requiredTiles(plan);
  await cache.loadAll(tiles);
  if (latest.View !== req.id) return null;
  const eyeM = Math.max(groundM, 0) + req.eyeAboveGroundM;
  const layers = sweepView(cache, plan, eyeM, req.eyeAboveGroundM, req.rangeM, req.minStepDeg);
  const missing = tiles.filter((t) => !cache.get(t.z, t.x, t.y)).length;
  return { kind: TerrainKind.View, id: req.id, result: { profile: layers, groundM, eyeM, tiles: tiles.length, missing } };
}

/** Coverage for the height-bound prepass: the deepest zoom that still takes the whole box in ~16 tiles. */
export function planHeightBound(pin: LngLat, rootLevel: number): { zoom: number; tiles: TileCoord[] } {
  const half = (BLOCKS_PER_SIDE / 2) * blockSideM(rootLevel);
  const bounds = enuBoxUnitBounds(pin, -half, -half, half, half);
  let zoom = demZoom(8);
  let tiles = tilesInBounds(bounds, zoom);
  for (let z = zoom + 1; z <= demZoom(12); z++) {
    const deeper = tilesInBounds(bounds, z);
    if (deeper.length > 16) break;
    zoom = z;
    tiles = deeper;
  }
  return { zoom, tiles };
}

/** Quadtree levels, finest first, each posted as soon as its DEM tiles are in. */
async function mesh(req: MeshRequest): Promise<null> {
  const t0 = performance.now();
  const g = await groundAt(req.pin);
  if (latest.Mesh !== req.id) return null;
  const groundM = Number.isNaN(g) ? 0 : g;
  const eyeM = Math.max(groundM, 0) + req.eyeAboveGroundM;
  const rootLevel = levelsForRange(req.rangeM) - 1;
  const plan = planHeightBound(req.pin, rootLevel);
  await cache.loadAll(plan.tiles);
  if (latest.Mesh !== req.id) return null;
  const heightBoundM = buildHeightBound(req.pin, cache, plan.zoom, metersPerPixel(req.pin.lat, plan.zoom, TERRAIN_TILE_SIZE), rootLevel);
  const sel = selectBlocks({
    rangeM: req.rangeM,
    demCellM: Math.max(MESH_MIN_CELL_M, metersPerPixel(req.pin.lat, TERRAIN_MAX_ZOOM, TERRAIN_TILE_SIZE)),
    view: req.view,
    heightBoundM,
    eyeM
  });
  for (const { level, blocks } of sel.levels) {
    const zoom = zoomForResolution(req.pin.lat, levelCellM(level), demZoom(8), TERRAIN_MAX_ZOOM, TERRAIN_TILE_SIZE);
    // Only the selected blocks: a level-1 leaf 10 km out would drag in thousands of the finest tiles otherwise.
    const tiles = new Map<string, TileCoord>();
    // The halo covers the cubic stencil's two posts past the block, or its edge would fall back to bilinear.
    const haloM = levelCellM(level) + 2 * metersPerPixel(req.pin.lat, zoom, TERRAIN_TILE_SIZE);
    for (const b of blocks) for (const t of tilesInBounds(blockUnitBounds(req.pin, b, haloM), zoom)) tiles.set(tileKey(t.z, t.x, t.y), t);
    // oxlint-disable-next-line no-await-in-loop -- a level is posted before the next one is fetched
    await cache.loadAll([...tiles.values()]);
    if (latest.Mesh !== req.id) return null;
    // C1 heights: a bilinear surface creases at every DEM post, and the shadow terminator shows it.
    const out = buildLevel(req.pin, eyeM, level, blocks, (lng, lat) => elevationAtCubic(cache, lng, lat, zoom));
    if (latest.Mesh !== req.id) return null;
    const result = { mesh: out, zoom, eyeM, groundM, levels: sel.levels.length, tiles: tiles.size, reachM: sel.reachM, targetRad: sel.targetRad, ms: performance.now() - t0 };
    scope.postMessage({ kind: TerrainKind.Mesh, id: req.id, result } satisfies TerrainResponse, [out.pos.buffer, out.nrm.buffer, out.idx.buffer, out.blockStart.buffer, out.blockBox.buffer]);
  }
  return null;
}

function dispatch(req: TerrainRequest): Promise<TerrainResponse | null> {
  switch (req.kind) {
    case TerrainKind.Elevation:
    case TerrainKind.Points:
      return elevation(req);
    case TerrainKind.Profile:
      return profile(req);
    case TerrainKind.Horizon:
      return horizon(req);
    case TerrainKind.View:
      return view(req);
    case TerrainKind.Mesh:
      return mesh(req);
  }
}

scope.addEventListener('message', (e: MessageEvent<TerrainRequest>) => {
  const req = e.data;
  latest[req.kind] = req.id;
  dispatch(req).then(
    (res) => {
      if (res) scope.postMessage(res);
    },
    (err: unknown) => {
      const error = err instanceof Error ? err.message : String(err);
      scope.postMessage({ kind: 'Error', id: req.id, of: req.kind, error } satisfies TerrainResponse);
    }
  );
});
