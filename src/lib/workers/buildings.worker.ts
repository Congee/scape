/// <reference lib="webworker" />
import { groundForRows, groupRowsAt, heightAtPoint, pickRows, suppressedIds, suppressRing, suppressRingTiles, suppressRows, tilesForWedge, type SuppressRing } from '@core/geo/buildingTiles';
import type { LngLat } from '@core/geo/geodesy';
import { meshOccluderParts } from '@core/geo/meshOcclude';
import { frameOf, frameToLngLat, maskFrame, shadowMask, type MaskFrame } from '@core/geo/shadowMask';
import { lod2RegionsNear, type Lod2Region, type Lod2Source } from '@core/lod2/regions';
import { lod2BuildingAt, lod2HeightAboveM, lod2Triangles, placeLod2, type Lod2Tile } from '@core/lod2/tile';
import type { WalkContent } from '@core/lod2/tileset';
import { edgeNeighbours, mergeTileRows, type TileRows } from '@core/geo/tileStitch';
import { stampFootprint, stampTriangles, sunCeiling, type HeightGrid } from '@core/geo/sunCeiling';
import { cubicStencilTiles, demRowAt, elevationAtCubic, lowestGroundAt, withDemTiles } from '@core/terrain/dem';
import { lngLatToTilePixel, tileKey, tilePixelToLngLat, tilesInBounds, zoomForResolution, type TileCoord } from '@core/terrain/tiles';
import { fetchBuildingBatch, setBuildingTileCacheSize, type DecodedBuildings } from '@data/buildingTiles';
import { fetchLod2Tile, setLod2Geoid, setLod2TileCacheSize, walkRegion } from '@data/lod2Tiles';
import { demCacheTiles, demZoom, DemCache, TERRAIN_TILE_SIZE } from '@data/terrainTiles';
import { BuildingsKind, MASK_WORKER_NAME, type BuildingBatch, type BuildingsRequest, type BuildingsResponse, type GeoidSync, type GroundAtRequest, type HeightAtRequest, type Lod2Placed, type Lod2Request, type MaskRequest, type ModelsSync, type RowsAtRequest, type SuppressedIdsRequest, type TilesRequest, type WorkerModel } from './buildings.protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
/** The map's mask runs in a second instance of this module, so its caches are sized for the map rect. */
const isMask = scope.name === MASK_WORKER_NAME;
const dem = new DemCache(demCacheTiles(isMask ? 320 : 512));
if (isMask) setBuildingTileCacheSize(96);
setLod2TileCacheSize(isMask ? 24 : 12);
/** Zoom of the buildings archive; `tilesForWedge` enumerates the same level. */
const BUILDINGS_ZOOM = 14;
/** Ground under one building: short of the source's finest, which would quadruple the tiles for sub-metre posts a footprint cannot use. */
const BUILDING_GROUND_ZOOM = demZoom(16);
/** Coarsest and finest DEM zoom the map's shadow mask reads. */
const CEILING_MIN_ZOOM = demZoom(8);
const CEILING_MAX_ZOOM = demZoom(14);
/** The map rect covers far more ground than the wedge at its coarsest. */
const MASK_TILE_MAX = 256;
/** Triangle budgets for LoD2, nearest tiles first; past them Overture stands in. */
const LOD2_VIEW_TRIS = 1_000_000;
const LOD2_MASK_TRIS = 2_000_000;
/** A leaf-only tileset's parents carry no content, so this sets the range at which LoD2 appears. */
const LOD2_MAX_ERROR_PX = 16;
/** Tiles fetched ahead of the one being placed. */
const LOD2_AHEAD = 4;
let latest = 0;
let latestLod2 = 0;
/** Triangles per placed url, so a tile the caller holds is kept without decoding it again. */
const lod2Tris = new Map<string, number>();
/** Newest map-mask id; the map centre is not the camera pin, so it gets its own counter and cache. */
let latestMask = 0;
let models: WorkerModel[] = [];
let modelsRev = 0;
let suppress: SuppressRing[] = [];
let geoidKey = '';

function syncModels(req: ModelsSync): void {
  models = req.models;
  modelsRev = req.rev;
  suppress = models.flatMap((m) => m.suppress.map(suppressRing));
}

function syncGeoid(req: GeoidSync): void {
  geoidKey = req.key;
  setLod2Geoid(req.key);
}

function tileAt(p: LngLat, z: number): TileCoord {
  const t = lngLatToTilePixel(p.lng, p.lat, z);
  return { z, x: t.x, y: t.y };
}

/** Copies the cached arrays so the transfer never detaches what the cache still holds. */
function withGround(batch: DecodedBuildings, groundM: Float32Array): { batch: BuildingBatch; transfer: ArrayBuffer[] } {
  const out: BuildingBatch = {
    tileKey: batch.tileKey,
    count: batch.count,
    ringStart: batch.ringStart.slice(),
    lng: batch.lng.slice(),
    lat: batch.lat.slice(),
    heightM: batch.heightM.slice(),
    minHeightM: batch.minHeightM.slice(),
    roofShape: batch.roofShape.slice(),
    roofHeightM: batch.roofHeightM.slice(),
    roofDirDeg: batch.roofDirDeg.slice(),
    roofAcross: batch.roofAcross.slice(),
    cLng: batch.cLng.slice(),
    cLat: batch.cLat.slice(),
    groundM
  };
  const arrays = [out.ringStart, out.lng, out.lat, out.heightM, out.minHeightM, out.roofShape, out.roofHeightM, out.roofDirDeg, out.roofAcross, out.cLng, out.cLat, out.groundM];
  return { batch: out, transfer: arrays.map((a) => a.buffer as ArrayBuffer) };
}

/** Ground per row on the surface the mesh draws, after loading the DEM tiles its samples need. */
// A fixed finest zoom, not the mesh's per-level one: that depends on view direction, so bases would shift on pan.
async function groundOf(decoded: DecodedBuildings): Promise<Float32Array> {
  if (decoded.count === 0) return new Float32Array(0);
  const need = new Map<string, TileCoord>();
  const want = (lng: number, lat: number) => {
    for (const t of cubicStencilTiles(lng, lat, BUILDING_GROUND_ZOOM, TERRAIN_TILE_SIZE)) need.set(tileKey(t.z, t.x, t.y), t);
  };
  for (let i = 0; i < decoded.count; i++) want(decoded.cLng[i], decoded.cLat[i]);
  for (let i = 0; i < decoded.lng.length; i++) want(decoded.lng[i], decoded.lat[i]);
  return withDemTiles(dem, [...need.values()], () => groundForRows(decoded, (lng, lat) => elevationAtCubic(dem, lng, lat, BUILDING_GROUND_ZOOM)));
}

async function run(req: TilesRequest): Promise<void> {
  const have = new Set(req.have);
  const tiles = tilesForWedge(req.pin, req.azFromDeg, req.azSpanDeg, req.rangeM).filter((t) => !have.has(tileKey(t.z, t.x, t.y)));
  let missing = 0;
  let sent = 0;
  // All fetches start now so the data layer's concurrency limiter runs; they are consumed nearest first.
  const pending = tiles.map((t) => fetchBuildingBatch(t));
  for (let n = 0; n < tiles.length; n++) {
    if (latest !== req.id) return;
    // oxlint-disable-next-line no-await-in-loop -- tiles stream nearest first, one at a time
    const decoded = await pending[n];
    if (latest !== req.id) return;
    if (!decoded) {
      missing++;
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- one DEM wait per streamed tile
    const groundM = await groundOf(decoded);
    if (latest !== req.id) return;
    const { batch, transfer } = withGround(decoded, groundM);
    scope.postMessage({ kind: BuildingsKind.Tiles, id: req.id, batch } satisfies BuildingsResponse, transfer);
    sent++;
  }
  if (latest !== req.id) return;
  scope.postMessage({ kind: BuildingsKind.Done, id: req.id, tiles: sent, missing } satisfies BuildingsResponse);
}

/** Normalized Mercator extent of a grid laid out in `frame`'s local Mercator metres. */
function frameBounds(f: MaskFrame, g: HeightGrid): { x0: number; x1: number; y0: number; y1: number } {
  const x0 = f.x + (g.originE - g.cellM / 2) / f.mPerUnit;
  const y1 = f.y - (g.originN - g.cellM / 2) / f.mPerUnit;
  return { x0, x1: x0 + (g.nx * g.cellM) / f.mPerUnit, y0: y1 - (g.ny * g.cellM) / f.mPerUnit, y1 };
}

/** Height grid for the map's shadow rect; only the sun march is redone while the map stays put. */
let cachedMask: { key: string; frame: MaskFrame; grid: HeightGrid; lod2: Lod2Source[] } | null = null;

/** Terrain over a grid laid out in local Mercator metres; latitude varies by row only. */
function fillFrameTerrain(g: HeightGrid, f: MaskFrame, zoom: number): boolean {
  let complete = true;
  for (let iy = 0; iy < g.ny; iy++) {
    const lat = tilePixelToLngLat(0, 0, 0, f.x, f.y - (g.originN + iy * g.cellM) / f.mPerUnit, 1).lat;
    const sample = demRowAt(dem, lat, zoom);
    const row = iy * g.nx;
    for (let ix = 0; ix < g.nx; ix++) {
      const lng = (f.x + (g.originE + ix * g.cellM) / f.mPerUnit) * 360 - 180;
      // Terrarium reads water as bathymetry, and the datum is sea level.
      const h = Math.max(sample(lng), 0);
      g.h[row + ix] = h;
      if (Number.isNaN(h)) complete = false;
    }
  }
  return complete;
}

/** Raises the grid to every roof standing over it; returns the LoD2 sources it stamped. Stops early, partly stamped, once `live` turns false. */
async function stampFrameBuildings(g: HeightGrid, f: MaskFrame, live: () => boolean): Promise<Lod2Source[]> {
  const lod2 = await stampFrameLod2(g, f, live);
  if (!live()) return lod2.regions;
  const hide = lod2.rings.length > 0 ? [...suppress, ...lod2.rings] : suppress;
  const tiles = tilesInBounds(frameBounds(f, g), BUILDINGS_ZOOM).slice(0, MASK_TILE_MAX);
  const decoded = await Promise.all(tiles.map((t) => fetchBuildingBatch(t)));
  if (!live()) return lod2.regions;
  const grounds = await Promise.all(decoded.map((b) => (b ? groundOf(b) : null)));
  const ringE: number[] = [];
  const ringN: number[] = [];
  for (const [t, raw] of decoded.entries()) {
    const all = grounds[t];
    if (!raw || !all) continue;
    const b = suppressRows({ ...raw, groundM: all }, hide);
    const ground = b.groundM;
    for (let i = 0; i < b.count; i++) {
      const gm = ground[i];
      if (Number.isNaN(gm)) continue;
      ringE.length = 0;
      ringN.length = 0;
      for (let j = b.ringStart[i]; j < b.ringStart[i + 1]; j++) {
        const p = frameOf(f, { lng: b.lng[j], lat: b.lat[j] });
        ringE.push(p.e);
        ringN.push(p.n);
      }
      stampFootprint(g, ringE, ringN, Math.max(gm, 0) + b.heightM[i]);
    }
  }
  for (const m of models) {
    const nv = m.tris.length / 3;
    const e = new Float64Array(nv);
    const n = new Float64Array(nv);
    const u = new Float64Array(nv);
    for (let v = 0; v < nv; v++) {
      const p = frameOf(f, { lng: m.tris[v * 3], lat: m.tris[v * 3 + 1] });
      e[v] = p.e;
      n[v] = p.n;
      u[v] = m.tris[v * 3 + 2];
    }
    stampTriangles(g, e, n, u);
  }
  return lod2.regions;
}

/** Every leaf in `rangeM` of `p` all around, nearest first, with its region. */
async function lod2Around(p: LngLat, rangeM: number): Promise<{ c: WalkContent; region: Lod2Region }[]> {
  const out: { c: WalkContent; region: Lod2Region }[] = [];
  for (const region of lod2RegionsNear(p, rangeM)) {
    // oxlint-disable-next-line no-await-in-loop -- regions rarely overlap
    const contents = await walkRegion(region, { pin: p, eyeH: region.geoidM, pxPerRad: 1e9, maxErrorPx: 1, rangeM, azFromDeg: 0, azSpanDeg: 360 });
    for (const c of contents) out.push({ c, region });
  }
  return out.toSorted((a, b) => a.c.distM - b.c.distM);
}

function stampLod2(g: HeightGrid, f: MaskFrame, t: Lod2Tile): void {
  const tris = lod2Triangles(t);
  const nv = tris.length / 3;
  const e = new Float64Array(nv);
  const n = new Float64Array(nv);
  const u = new Float64Array(nv);
  for (let v = 0; v < nv; v++) {
    const p = frameOf(f, { lng: tris[v * 3], lat: tris[v * 3 + 1] });
    e[v] = p.e;
    n[v] = p.n;
    u[v] = tris[v * 3 + 2];
  }
  stampTriangles(g, e, n, u);
}

/** Stamps the LoD2 meshes over the grid and returns their hulls, which the Overture rows then give way to. */
async function stampFrameLod2(g: HeightGrid, f: MaskFrame, live: () => boolean): Promise<{ rings: SuppressRing[]; regions: Lod2Source[] }> {
  const wE = g.nx * g.cellM;
  const wN = g.ny * g.cellM;
  const centre = frameToLngLat(f, g.originE + wE / 2, g.originN + wN / 2);
  const around = await lod2Around(centre, Math.hypot(wE, wN) / 2);
  const rings: SuppressRing[] = [];
  const regions = new Set<Lod2Source>();
  let tris = 0;
  for (const { c, region } of around) {
    if (!live()) break;
    // oxlint-disable-next-line no-await-in-loop -- nearest first until the budget runs out
    const t = await fetchLod2Tile(c, region).catch((err: unknown) => {
      console.warn('[scape] LoD2 tile skipped in the shadow mask:', c.url, err);
      return null;
    });
    if (!t) continue;
    if (tris + t.idx.length / 3 > LOD2_MASK_TRIS) break;
    tris += t.idx.length / 3;
    stampLod2(g, f, t);
    regions.add(region.id);
    for (const b of t.buildings) rings.push(suppressRing(b.hull));
  }
  return { rings, regions: [...regions] };
}

/** Null when a newer mask request has superseded this one. */
async function maskFor(req: MaskRequest): Promise<{ mask: Uint8Array; lod2: Lod2Source[] } | null> {
  const key = `${req.centre.lat.toFixed(6)},${req.centre.lng.toFixed(6)}|${req.originE}|${req.originN}|${req.nx}|${req.ny}|${req.cellM}|${req.buildings}|${req.buildings ? `${modelsRev}|${geoidKey}` : 0}`;
  let grid = cachedMask?.key === key ? cachedMask.grid : null;
  let frame = cachedMask?.key === key ? cachedMask.frame : null;
  let lod2 = cachedMask?.key === key ? cachedMask.lod2 : [];
  if (!grid || !frame) {
    frame = maskFrame(req.centre);
    grid = { cellM: req.cellM, nx: req.nx, ny: req.ny, originE: req.originE, originN: req.originN, h: new Float32Array(req.nx * req.ny) };
    const zoom = zoomForResolution(req.centre.lat, req.cellM, CEILING_MIN_ZOOM, CEILING_MAX_ZOOM, TERRAIN_TILE_SIZE);
    const g = grid;
    const f = frame;
    const complete = await withDemTiles(dem, tilesInBounds(frameBounds(f, g), zoom), () => latestMask === req.id && fillFrameTerrain(g, f, zoom));
    if (latestMask !== req.id) return null;
    // An absent building tile is far more often an empty one than a failure, and letting it veto
    // the cache would refetch every tile on each sun change.
    lod2 = req.buildings ? await stampFrameBuildings(grid, frame, () => latestMask === req.id) : [];
    if (latestMask !== req.id) return null;
    cachedMask = complete ? { key, frame, grid, lod2 } : null;
  }
  return { mask: shadowMask(grid.h, sunCeiling(grid, req.sunAzDeg, req.sunAltDeg), req.softM), lod2 };
}

async function shade(req: MaskRequest): Promise<void> {
  const t0 = performance.now();
  const built = await maskFor(req);
  if (!built || latestMask !== req.id) return;
  const { mask, lod2 } = built;
  const { id, centre, originE, originN, nx, ny, cellM } = req;
  scope.postMessage({ kind: BuildingsKind.Shade, id, centre, originE, originN, nx, ny, cellM, mask, lod2, ms: performance.now() - t0 } satisfies BuildingsResponse, [mask.buffer]);
}

/** Apex of the LoD2 building under `p` above the ground there; null where none stands. */
async function lod2HeightAt(p: LngLat): Promise<number | null> {
  for (const { c, region } of await lod2Around(p, 1)) {
    // oxlint-disable-next-line no-await-in-loop -- the first tile holding the point answers
    const t = await fetchLod2Tile(c, region).catch(() => null);
    const b = t ? lod2BuildingAt(t, p) : -1;
    if (t && b >= 0) return groundedHeight(t, b, p);
  }
  return null;
}

async function groundedHeight(t: Lod2Tile, b: number, p: LngLat): Promise<number> {
  return lod2HeightAboveM(t.buildings[b], await lowestGroundAt(dem, [p], BUILDING_GROUND_ZOOM, TERRAIN_TILE_SIZE));
}

/** One-shot lookup; it shares the tile cache with the wedge, so a nearby target is usually free. */
async function heightAt(req: HeightAtRequest): Promise<void> {
  const fromLod2 = await lod2HeightAt(req.point);
  const decoded = fromLod2 == null ? await fetchBuildingBatch(tileAt(req.point, BUILDINGS_ZOOM)) : null;
  const heightM = fromLod2 ?? (decoded ? heightAtPoint(suppressRows(decoded, suppress), req.point) : null);
  scope.postMessage({ kind: BuildingsKind.Height, id: req.id, heightM } satisfies BuildingsResponse);
}

/** A building reaching past a 3×3 block of z14 tiles is too big to seed whole. */
const SEED_MAX_TILES = 9;

/** The hit building's rows from every tile it crosses, its pieces rejoined. */
async function rowsAt(req: RowsAtRequest): Promise<void> {
  const first = tileAt(req.point, BUILDINGS_ZOOM);
  const decoded = await fetchBuildingBatch(first);
  const hit = decoded ? groupRowsAt(decoded, req.point) : null;
  if (!hit) {
    scope.postMessage({ kind: BuildingsKind.Rows, id: req.id, batch: null } satisfies BuildingsResponse);
    return;
  }
  const ids = new Set(hit.buildingId.filter((id) => id !== null));
  const got = new Map<string, TileRows>([[tileKey(first.z, first.x, first.y), { tile: first, rows: hit }]]);
  const queue = ids.size > 0 ? edgeNeighbours(hit, first) : [];
  while (queue.length > 0 && got.size < SEED_MAX_TILES) {
    const t = queue.shift()!;
    const key = tileKey(t.z, t.x, t.y);
    if (got.has(key)) continue;
    // oxlint-disable-next-line no-await-in-loop -- each tile names the next ones to fetch
    const more = await fetchBuildingBatch(t);
    const rows = more ? pickRows(more, (i) => ids.has(more.buildingId[i] ?? '')) : null;
    if (!rows || rows.count === 0) continue;
    got.set(key, { tile: t, rows });
    queue.push(...edgeNeighbours(rows, t));
  }
  const merged = got.size > 1 ? mergeTileRows([...got.values()]) : hit;
  const { batch, transfer } = withGround(merged, await groundOf(merged));
  scope.postMessage({ kind: BuildingsKind.Rows, id: req.id, batch } satisfies BuildingsResponse, transfer);
}

async function hiddenIds(req: SuppressedIdsRequest): Promise<void> {
  const tiles = new Map<string, TileCoord>();
  for (const s of suppress) for (const t of suppressRingTiles(s, BUILDINGS_ZOOM)) tiles.set(tileKey(t.z, t.x, t.y), t);
  const batches = await Promise.all([...tiles.values()].map((t) => fetchBuildingBatch(t)));
  const ids = [...new Set(batches.flatMap((b) => (b ? suppressedIds(b, suppress) : [])))];
  scope.postMessage({ kind: BuildingsKind.Ids, id: req.id, ids } satisfies BuildingsResponse);
}

function placed(t: Lod2Tile, c: WalkContent, region: Lod2Region, req: Lod2Request, t0: number): { tile: Lod2Placed; transfer: ArrayBuffer[] } {
  const mesh = placeLod2(t, req.pin, req.eyeM);
  const tris = mesh.plane.length / 4;
  const occ = meshOccluderParts([mesh]);
  const tile: Lod2Placed = { url: c.url, region: region.id, mesh, hulls: t.buildings.map((b) => b.hull), bbox: t.bbox, tris, geoid: t.geoidGrid, occ, ms: performance.now() - t0 };
  const transfer = [mesh.pos, mesh.surfId, mesh.bldgId, mesh.idx, mesh.plane, mesh.surf, mesh.sphere, mesh.size, mesh.box, occ.tris, occ.boxes, occ.nodes].map((a) => a.buffer as ArrayBuffer);
  return { tile, transfer };
}

/** Streams the wedge's LoD2 tiles nearest first until the triangle budget is spent. */
async function lod2Run(req: Lod2Request): Promise<void> {
  const have = new Set(req.have);
  const urls: string[] = [];
  let tris = 0;
  let missing = 0;
  let error: string | null = null;
  const list: { c: WalkContent; region: Lod2Region }[] = [];
  for (const region of lod2RegionsNear(req.pin, req.rangeM)) {
    const view = { pin: req.pin, eyeH: req.eyeM + region.geoidM, pxPerRad: req.pxPerRad, maxErrorPx: LOD2_MAX_ERROR_PX, rangeM: req.rangeM, azFromDeg: req.azFromDeg, azSpanDeg: req.azSpanDeg };
    // oxlint-disable-next-line no-await-in-loop -- regions rarely overlap
    for (const c of await walkRegion(region, view)) list.push({ c, region });
    if (latestLod2 !== req.id) return;
  }
  list.sort((a, b) => a.c.distM - b.c.distM);
  const started = new Map<number, Promise<Lod2Tile | null>>();
  const start = (i: number) => {
    if (i >= list.length || started.has(i) || (have.has(list[i].c.url) && lod2Tris.has(list[i].c.url))) return;
    const p = fetchLod2Tile(list[i].c, list[i].region);
    // A prefetch left behind by a newer request or the budget is never awaited.
    p.catch(() => undefined);
    started.set(i, p);
  };
  for (let i = 0; i < list.length; i++) {
    if (latestLod2 !== req.id) return;
    const { c, region } = list[i];
    const known = have.has(c.url) ? lod2Tris.get(c.url) : undefined;
    if (known !== undefined) {
      if (tris + known > LOD2_VIEW_TRIS) break;
      tris += known;
      urls.push(c.url);
      continue;
    }
    for (let k = i; k <= i + LOD2_AHEAD; k++) start(k);
    const t0 = performance.now();
    let t: Lod2Tile | null = null;
    try {
      // oxlint-disable-next-line no-await-in-loop -- tiles stream nearest first, one at a time
      t = await started.get(i)!;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    if (latestLod2 !== req.id) return;
    if (!t) {
      missing++;
      continue;
    }
    if (tris + t.idx.length / 3 > LOD2_VIEW_TRIS) break;
    const { tile, transfer } = placed(t, c, region, req, t0);
    lod2Tris.set(c.url, tile.tris);
    tris += tile.tris;
    urls.push(c.url);
    scope.postMessage({ kind: BuildingsKind.Lod2Tile, id: req.id, tile } satisfies BuildingsResponse, transfer);
  }
  if (latestLod2 !== req.id) return;
  scope.postMessage({ kind: BuildingsKind.Lod2Done, id: req.id, urls, tris, missing, error } satisfies BuildingsResponse);
}

async function groundAt(req: GroundAtRequest): Promise<void> {
  const groundM = await lowestGroundAt(dem, req.points, BUILDING_GROUND_ZOOM, TERRAIN_TILE_SIZE);
  scope.postMessage({ kind: BuildingsKind.Ground, id: req.id, groundM } satisfies BuildingsResponse);
}

scope.addEventListener('message', (e: MessageEvent<BuildingsRequest>) => {
  const req = e.data;
  const fail = (err: unknown) => {
    const error = err instanceof Error ? err.message : String(err);
    scope.postMessage({ kind: BuildingsKind.Error, id: req.id, error } satisfies BuildingsResponse);
  };
  // Neither a height lookup nor a shadow field supersedes the wedge, so they leave `latest` alone.
  if (req.kind === BuildingsKind.Models) {
    syncModels(req);
    return;
  }
  if (req.kind === BuildingsKind.Geoid) {
    syncGeoid(req);
    return;
  }
  if (req.kind === BuildingsKind.HeightAt) {
    heightAt(req).catch(fail);
    return;
  }
  if (req.kind === BuildingsKind.RowsAt) {
    rowsAt(req).catch(fail);
    return;
  }
  if (req.kind === BuildingsKind.GroundAt) {
    groundAt(req).catch(fail);
    return;
  }
  if (req.kind === BuildingsKind.SuppressedIds) {
    hiddenIds(req).catch(fail);
    return;
  }
  if (req.kind === BuildingsKind.Lod2) {
    latestLod2 = req.id;
    lod2Run(req).catch((err: unknown) => {
      if (latestLod2 !== req.id) return;
      fail(err);
    });
    return;
  }
  if (req.kind === BuildingsKind.Mask) {
    latestMask = req.id;
    shade(req).catch((err: unknown) => {
      if (latestMask !== req.id) return;
      fail(err);
    });
    return;
  }
  latest = req.id;
  run(req).catch((err: unknown) => {
    if (latest !== req.id) return;
    fail(err);
  });
});
