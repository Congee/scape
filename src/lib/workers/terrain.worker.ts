/// <reference lib="webworker" />
import { bearingDeg, distanceM, geodesicBetween, normalizeLng, type LngLat } from '@core/geo/geodesy';
import { cubicStencilTiles, elevationAt, elevationAtCubic, memoSource } from '@core/terrain/dem';
import { buildDetailBound, buildHeightBound, planDetailBound } from '@core/terrain/heightBound';
import { BlockCache } from '@core/terrain/blockCache';
import { blockUnitBounds, BLOCKS_PER_SIDE, blockSideM, buildBlock, enuBoxUnitBounds, joinBlocks, levelCellM, levelsForRange, selectBlocks, type Selection } from '@core/terrain/mesh';
import { planSweep, requiredTiles, sweepColumns, sweepHorizon } from '@core/terrain/horizon';
import { analyzeSightline } from '@core/terrain/los';
import { assembleView, sweepView, type ViewProfile } from '@core/terrain/view';
import { lngLatToTilePixel, metersPerPixel, tileKey, tilesInBounds, zoomForResolution, type TileCoord } from '@core/terrain/tiles';
import { demCacheTiles, demZoom, DemCache, TERRAIN_MAX_ZOOM, TERRAIN_TILE_SIZE } from '@data/terrainTiles';
import { TerrainKind, type ElevationRequest, type HorizonRequest, type MeshRequest, type PointsRequest, type ProfileRequest, type TerrainRequest, type TerrainResponse, type ViewRequest } from './terrain.protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
/** Detail-bound zooms, in 256 px terms: z14 posts are ~7 m, z13 ~14 m at mid-latitudes. */
const DETAIL_ZOOMS = [demZoom(13), demZoom(14)] as const;
/** Narrower than this the detail bound usually pays, so its tiles load alongside the coarse ones; wider waits to be asked. */
const DETAIL_PREFETCH_HFOV_DEG = 6;
const cache = new DemCache(demCacheTiles(320));
// About 1500 blocks: an aim drag re-cuts the wedge, and most of it was built a moment ago.
const meshBlocks = new BlockCache(96 * 2 ** 20);
/** Newest request id per kind; older ones stop before the expensive step. */
const latest: Record<TerrainKind, number> = { Elevation: 0, Profile: 0, Horizon: 0, View: 0, Points: 0, Mesh: 0 };

function tileAt(p: LngLat, z: number): TileCoord {
  const t = lngLatToTilePixel(p.lng, p.lat, z);
  return { z, x: t.x, y: t.y };
}

/** The surface the mesh draws, so the eye and anything standing on the ground share it. */
async function groundAt(p: LngLat): Promise<number> {
  const want = cubicStencilTiles(p.lng, p.lat, TERRAIN_MAX_ZOOM, TERRAIN_TILE_SIZE);
  const release = cache.retain(want);
  try {
    await cache.loadAll(want);
    return elevationAtCubic(cache, p.lng, p.lat, TERRAIN_MAX_ZOOM);
  } finally {
    release();
  }
}

async function elevation(req: ElevationRequest | PointsRequest): Promise<TerrainResponse> {
  const tiles = new Map<string, TileCoord>();
  for (const p of req.points) for (const t of cubicStencilTiles(p.lng, p.lat, TERRAIN_MAX_ZOOM, TERRAIN_TILE_SIZE)) tiles.set(tileKey(t.z, t.x, t.y), t);
  const want = [...tiles.values()];
  const release = cache.retain(want);
  try {
    await cache.loadAll(want);
    const elevations = req.points.map((p) => elevationAtCubic(cache, p.lng, p.lat, TERRAIN_MAX_ZOOM));
    return { kind: req.kind, id: req.id, elevations };
  } finally {
    release();
  }
}

async function profile(req: ProfileRequest): Promise<TerrainResponse | null> {
  const { a, b, samples: n } = req;
  const totalM = distanceM(a, b);
  const zoom = zoomForResolution((a.lat + b.lat) / 2, Math.max(1, totalM / n), demZoom(6), demZoom(14), TERRAIN_TILE_SIZE);
  const lng = new Float32Array(n);
  const lat = new Float32Array(n);
  const distM = new Float32Array(n);
  const tiles = new Map<string, TileCoord>();
  const along = geodesicBetween(a, b);
  for (let i = 0; i < n; i++) {
    const q = along(i / (n - 1));
    const p = { lng: normalizeLng(q.lng), lat: q.lat };
    lng[i] = p.lng;
    lat[i] = p.lat;
    distM[i] = (totalM * i) / (n - 1);
    const t = tileAt(p, zoom);
    tiles.set(tileKey(t.z, t.x, t.y), t);
  }
  const want = [...tiles.values()];
  const release = cache.retain(want);
  const groundM = new Float32Array(n);
  let missing = 0;
  try {
    await cache.loadAll(want);
    if (latest.Profile !== req.id) return null;
    for (let i = 0; i < n; i++) {
      groundM[i] = elevationAt(cache, lng[i], lat[i], zoom);
      if (Number.isNaN(groundM[i])) missing++;
    }
  } finally {
    release();
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
  const release = cache.retain(tiles);
  try {
    await cache.loadAll(tiles);
    if (latest.Horizon !== req.id) return null;
    const eyeM = Math.max(groundM, 0) + req.eyeAboveGroundM;
    const skyline = sweepHorizon(cache, plan, eyeM, req.eyeAboveGroundM, req.rangeM);
    const missing = tiles.filter((t) => !cache.get(t.z, t.x, t.y)).length;
    return { kind: TerrainKind.Horizon, id: req.id, result: { profile: skyline, groundM, eyeM, tiles: tiles.length, missing } };
  } finally {
    release();
  }
}

/** Last view swept with every tile present, so a pan sweeps only the columns it newly needs. */
let lastView: { key: string; k0: number; v: ViewProfile } | null = null;

/** Finer and closer than the horizon sweep: the viewfinder shows the near ground too. */
async function view(req: ViewRequest): Promise<TerrainResponse | null> {
  const g = await groundAt(req.pin);
  const groundM = Number.isNaN(g) ? 0 : g;
  const eyeM = Math.max(groundM, 0) + req.eyeAboveGroundM;
  const step = req.azStepDeg;
  // Columns sit on a grid of the step, so one azimuth is swept the same way from any window.
  const k0 = Math.round(req.azFromDeg / step);
  const nAz = sweepColumns(req.azSpanDeg, step);
  const key = `${req.pin.lng},${req.pin.lat}|${eyeM}|${req.eyeAboveGroundM}|${step}|${req.rangeM}|${req.minStepDeg}`;
  const prev = lastView?.key === key ? lastView : null;
  const held = (k: number) => !!prev && k >= prev.k0 && k < prev.k0 + prev.v.nAz;
  const fresh: number[] = [];
  for (let k = k0; k < k0 + nAz; k++) if (!held(k)) fresh.push(k);
  const plan = planSweep(req.pin, req.rangeM, { azStepDeg: step, columns: fresh, minDistM: 20, minZoom: demZoom(8), maxZoom: demZoom(15), tileSize: TERRAIN_TILE_SIZE });
  const tiles = requiredTiles(plan);
  const release = cache.retain(tiles);
  try {
    await cache.loadAll(tiles);
    if (latest.View !== req.id) return null;
    const swept = sweepView(memoSource(cache), plan, eyeM, req.eyeAboveGroundM, req.rangeM, req.minStepDeg);
    const at = new Map(fresh.map((k, i) => [k, i]));
    const layers = fresh.length === nAz ? swept : assembleView(step, k0, nAz, req.rangeM, (k) => (held(k) ? { v: prev!.v, col: k - prev!.k0 } : { v: swept, col: at.get(k)! }));
    const missing = tiles.filter((t) => !cache.get(t.z, t.x, t.y)).length;
    if (missing === 0) lastView = { key, k0, v: layers };
    return { kind: TerrainKind.View, id: req.id, result: { profile: layers, groundM, eyeM, tiles: tiles.length, missing } };
  } finally {
    release();
  }
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
  const planDetail = () => (req.view ? planDetailBound(req.pin, req.view, req.rangeM, DETAIL_ZOOMS[0], DETAIL_ZOOMS[1], TERRAIN_TILE_SIZE) : null);
  const early = req.view && req.view.hfovDeg < DETAIL_PREFETCH_HFOV_DEG ? planDetail() : null;
  const releasePlan = cache.retain(plan.tiles);
  let sel: Selection;
  try {
    const coarse = cache.loadAll(plan.tiles);
    // Queued behind the coarse tiles, and unretained: the selection retains them only if it wants them.
    if (early) void cache.loadAll(early.tiles).catch(() => {});
    await coarse;
    if (latest.Mesh !== req.id) return null;
    const opts = {
      rangeM: req.rangeM,
      demCellM: metersPerPixel(req.pin.lat, TERRAIN_MAX_ZOOM, TERRAIN_TILE_SIZE),
      view: req.view,
      heightBoundM: buildHeightBound(req.pin, cache, plan.zoom, metersPerPixel(req.pin.lat, plan.zoom, TERRAIN_TILE_SIZE), rootLevel),
      eyeM
    };
    sel = selectBlocks(opts);
    // The detail tiles cost a load and their mips, so only where even the tightest bound could buy a finer frame.
    const detail = sel.detailMayPay ? (early ?? planDetail()) : null;
    if (detail) {
      const releaseDetail = cache.retain(detail.tiles);
      try {
        await cache.loadAll(detail.tiles);
        if (latest.Mesh !== req.id) return null;
        sel = selectBlocks({ ...opts, detailBoundM: buildDetailBound(req.pin, cache, detail.zoom, metersPerPixel(req.pin.lat, detail.zoom, TERRAIN_TILE_SIZE)) });
      } finally {
        releaseDetail();
      }
    }
  } finally {
    releasePlan();
  }
  const plans = sel.levels.map(({ level, blocks, skirtM }) => {
    const zoom = zoomForResolution(req.pin.lat, levelCellM(level), demZoom(8), TERRAIN_MAX_ZOOM, TERRAIN_TILE_SIZE);
    // Only the selected blocks: a level-1 leaf 10 km out would drag in thousands of the finest tiles otherwise.
    const tiles = new Map<string, TileCoord>();
    // The halo covers the cubic stencil's two posts past the block, or its edge would fall back to bilinear.
    const haloM = levelCellM(level) + 2 * metersPerPixel(req.pin.lat, zoom, TERRAIN_TILE_SIZE);
    const blockTiles = blocks.map((b) => tilesInBounds(blockUnitBounds(req.pin, b, haloM), zoom));
    for (const ts of blockTiles) for (const t of ts) tiles.set(tileKey(t.z, t.x, t.y), t);
    return { level, blocks, skirtM, zoom, tiles, blockTiles };
  });
  // Warms every level while the first one builds. Unretained and unawaited on purpose: the fetch queue is
  // FIFO so the finest level stays first, and each level still awaits its own retained load, so a tile
  // evicted after the prefetch is re-fetched rather than read as sea level.
  const union = new Map<string, TileCoord>();
  for (const p of plans) for (const [k, t] of p.tiles) union.set(k, t);
  void cache.loadAll([...union.values()]).catch(() => {});
  meshBlocks.setAnchor(`${req.pin.lng},${req.pin.lat}|${eyeM}`);
  for (const { level, blocks, skirtM, zoom, tiles, blockTiles } of plans) {
    const want = [...tiles.values()];
    const release = cache.retain(want);
    try {
      // oxlint-disable-next-line no-await-in-loop -- a level is posted before the next one is fetched
      await cache.loadAll(want);
      if (latest.Mesh !== req.id) return null;
      // C1 heights: a bilinear surface creases at every DEM post, and the shadow terminator shows it.
      const src = memoSource(cache);
      const sample = (lng: number, lat: number) => elevationAtCubic(src, lng, lat, zoom);
      let reused = 0;
      const parts = blocks.map((b, i) => {
        const drop = skirtM[i];
        const key = `${level}/${b.ix}/${b.iy}/${zoom}/${drop}`;
        const hit = meshBlocks.get(key);
        if (hit) {
          reused++;
          return hit;
        }
        const part = buildBlock(req.pin, eyeM, level, b, sample, drop);
        // A block over an absent tile holds sea level or a bilinear edge; built again once the tile lands.
        if (part.missing === 0 && blockTiles[i].every((t) => cache.get(t.z, t.x, t.y))) meshBlocks.set(key, part);
        return part;
      });
      const out = joinBlocks(level, parts);
      if (latest.Mesh !== req.id) return null;
      const result = { mesh: out, zoom, eyeM, groundM, levels: sel.levels.length, reused, cacheBytes: meshBlocks.bytes, tiles: tiles.size, reachM: sel.reachM, targetRad: sel.targetRad, minCellM: sel.minCellM, ms: performance.now() - t0 };
      scope.postMessage({ kind: TerrainKind.Mesh, id: req.id, result } satisfies TerrainResponse, [out.pos.buffer, out.nrm.buffer, out.idx.buffer, out.blockStart.buffer, out.blockBox.buffer]);
    } finally {
      release();
    }
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
