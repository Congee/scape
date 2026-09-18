/// <reference lib="webworker" />
import { groundForRows, heightAtPoint, tilesForWedge } from '@core/geo/buildingTiles';
import type { LngLat } from '@core/geo/geodesy';
import { elevationAt } from '@core/terrain/dem';
import { lngLatToTilePixel, tileKey, type TileCoord } from '@core/terrain/tiles';
import { fetchBuildingBatch, type DecodedBuildings } from '@data/buildingTiles';
import { DemCache, POINT_ZOOM } from '@data/terrainTiles';
import { BuildingsKind, type BuildingBatch, type BuildingsRequest, type BuildingsResponse, type HeightAtRequest, type TilesRequest } from './buildings.protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const dem = new DemCache(220);
/** Zoom of the buildings archive; `tilesForWedge` enumerates the same level. */
const BUILDINGS_ZOOM = 14;
let latest = 0;

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
    let groundM = new Float32Array(decoded.count);
    if (decoded.count > 0) {
      const need = new Map<string, TileCoord>();
      const want = (lng: number, lat: number) => {
        const t = tileAt({ lng, lat }, POINT_ZOOM);
        need.set(tileKey(t.z, t.x, t.y), t);
      };
      for (let i = 0; i < decoded.count; i++) want(decoded.cLng[i], decoded.cLat[i]);
      for (let i = 0; i < decoded.lng.length; i++) want(decoded.lng[i], decoded.lat[i]);
      // oxlint-disable-next-line no-await-in-loop -- one DEM wait per streamed tile
      await dem.loadAll([...need.values()]);
      groundM = groundForRows(decoded, (lng, lat) => elevationAt(dem, lng, lat, POINT_ZOOM));
    }
    if (latest !== req.id) return;
    const { batch, transfer } = withGround(decoded, groundM);
    scope.postMessage({ kind: BuildingsKind.Tiles, id: req.id, batch } satisfies BuildingsResponse, transfer);
    sent++;
  }
  if (latest !== req.id) return;
  scope.postMessage({ kind: BuildingsKind.Done, id: req.id, tiles: sent, missing } satisfies BuildingsResponse);
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
  // A height lookup never supersedes the wedge, so it leaves `latest` alone.
  if (req.kind === BuildingsKind.HeightAt) {
    heightAt(req).catch(fail);
    return;
  }
  latest = req.id;
  run(req).catch((err: unknown) => {
    if (latest !== req.id) return;
    fail(err);
  });
});
