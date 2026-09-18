/// <reference lib="webworker" />
import { groundForRows, heightAtPoint, tilesForWedge } from '@core/geo/buildingTiles';
import type { LngLat } from '@core/geo/geodesy';
import { frameOf, maskFrame, shadowMask, type MaskFrame } from '@core/geo/shadowMask';
import { stampFootprint, sunCeiling, type HeightGrid } from '@core/geo/sunCeiling';
import { cubicStencilTiles, demRowAt, elevationAtCubic } from '@core/terrain/dem';
import { lngLatToTilePixel, tileKey, tilePixelToLngLat, tilesInBounds, zoomForResolution, type TileCoord } from '@core/terrain/tiles';
import { fetchBuildingBatch, setBuildingTileCacheSize, type DecodedBuildings } from '@data/buildingTiles';
import { DemCache, TERRAIN_MAX_ZOOM } from '@data/terrainTiles';
import { BuildingsKind, MASK_WORKER_NAME, type BuildingBatch, type BuildingsRequest, type BuildingsResponse, type HeightAtRequest, type MaskRequest, type TilesRequest } from './buildings.protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
/** The map's mask runs in a second instance of this module, so its caches are sized for the map rect. */
const isMask = scope.name === MASK_WORKER_NAME;
const dem = new DemCache(isMask ? 320 : 512);
if (isMask) setBuildingTileCacheSize(96);
/** Zoom of the buildings archive; `tilesForWedge` enumerates the same level. */
const BUILDINGS_ZOOM = 14;
/** Coarsest and finest DEM zoom the map's shadow mask reads. */
const CEILING_MIN_ZOOM = 8;
const CEILING_MAX_ZOOM = 14;
/** The map rect covers far more ground than the wedge at its coarsest. */
const MASK_TILE_MAX = 256;
let latest = 0;
/** Newest map-mask id; the map centre is not the camera pin, so it gets its own counter and cache. */
let latestMask = 0;

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
    for (const t of cubicStencilTiles(lng, lat, TERRAIN_MAX_ZOOM)) need.set(tileKey(t.z, t.x, t.y), t);
  };
  for (let i = 0; i < decoded.count; i++) want(decoded.cLng[i], decoded.cLat[i]);
  for (let i = 0; i < decoded.lng.length; i++) want(decoded.lng[i], decoded.lat[i]);
  await dem.loadAll([...need.values()]);
  return groundForRows(decoded, (lng, lat) => elevationAtCubic(dem, lng, lat, TERRAIN_MAX_ZOOM));
}

async function run(req: TilesRequest): Promise<void> {
  const tiles = tilesForWedge(req.pin, req.azFromDeg, req.azSpanDeg, req.rangeM);
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
let cachedMask: { key: string; frame: MaskFrame; grid: HeightGrid } | null = null;

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

/** Raises the grid to every roof standing over it. */
async function stampFrameBuildings(g: HeightGrid, f: MaskFrame): Promise<void> {
  const tiles = tilesInBounds(frameBounds(f, g), BUILDINGS_ZOOM).slice(0, MASK_TILE_MAX);
  const decoded = await Promise.all(tiles.map((t) => fetchBuildingBatch(t)));
  const grounds = await Promise.all(decoded.map((b) => (b ? groundOf(b) : null)));
  const ringE: number[] = [];
  const ringN: number[] = [];
  for (const [t, b] of decoded.entries()) {
    const ground = grounds[t];
    if (!b || !ground) continue;
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
}

/** Null when a newer mask request has superseded this one. */
async function maskFor(req: MaskRequest): Promise<Uint8Array | null> {
  const key = `${req.centre.lat.toFixed(6)},${req.centre.lng.toFixed(6)}|${req.originE}|${req.originN}|${req.nx}|${req.ny}|${req.cellM}`;
  let grid = cachedMask?.key === key ? cachedMask.grid : null;
  let frame = cachedMask?.key === key ? cachedMask.frame : null;
  if (!grid || !frame) {
    frame = maskFrame(req.centre);
    grid = { cellM: req.cellM, nx: req.nx, ny: req.ny, originE: req.originE, originN: req.originN, h: new Float32Array(req.nx * req.ny) };
    const zoom = zoomForResolution(req.centre.lat, req.cellM, CEILING_MIN_ZOOM, CEILING_MAX_ZOOM);
    await dem.loadAll(tilesInBounds(frameBounds(frame, grid), zoom));
    if (latestMask !== req.id) return null;
    const complete = fillFrameTerrain(grid, frame, zoom);
    // An absent building tile is far more often an empty one than a failure, and letting it veto
    // the cache would refetch every tile on each sun change.
    await stampFrameBuildings(grid, frame);
    if (latestMask !== req.id) return null;
    cachedMask = complete ? { key, frame, grid } : null;
  }
  return shadowMask(grid.h, sunCeiling(grid, req.sunAzDeg, req.sunAltDeg), req.softM);
}

async function shade(req: MaskRequest): Promise<void> {
  const t0 = performance.now();
  const mask = await maskFor(req);
  if (!mask || latestMask !== req.id) return;
  const { id, centre, originE, originN, nx, ny, cellM } = req;
  scope.postMessage({ kind: BuildingsKind.Shade, id, centre, originE, originN, nx, ny, cellM, mask, ms: performance.now() - t0 } satisfies BuildingsResponse, [mask.buffer]);
}

/** One-shot lookup; it shares the tile cache with the wedge, so a nearby target is usually free. */
async function heightAt(req: HeightAtRequest): Promise<void> {
  const decoded = await fetchBuildingBatch(tileAt(req.point, BUILDINGS_ZOOM));
  const heightM = decoded ? heightAtPoint(decoded, req.point) : null;
  scope.postMessage({ kind: BuildingsKind.Height, id: req.id, heightM } satisfies BuildingsResponse);
}

scope.addEventListener('message', (e: MessageEvent<BuildingsRequest>) => {
  const req = e.data;
  const fail = (err: unknown) => {
    const error = err instanceof Error ? err.message : String(err);
    scope.postMessage({ kind: BuildingsKind.Error, id: req.id, error } satisfies BuildingsResponse);
  };
  // Neither a height lookup nor a shadow field supersedes the wedge, so they leave `latest` alone.
  if (req.kind === BuildingsKind.HeightAt) {
    heightAt(req).catch(fail);
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
