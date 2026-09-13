/// <reference lib="webworker" />
import { tilesForWedge } from '@core/geo/buildingTiles';
import type { LngLat } from '@core/geo/geodesy';
import { elevationAt } from '@core/terrain/dem';
import { lngLatToTilePixel, tileKey, type TileCoord } from '@core/terrain/tiles';
import { fetchBuildingBatch, type DecodedBuildings } from '@data/buildingTiles';
import { DemCache, POINT_ZOOM } from '@data/terrainTiles';
import { BuildingsKind, type BuildingBatch, type BuildingsResponse, type TilesRequest } from './buildings.protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const dem = new DemCache(220);
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
    cLng: batch.cLng.slice(),
    cLat: batch.cLat.slice(),
    groundM
  };
  return { batch: out, transfer: [out.ringStart, out.lng, out.lat, out.heightM, out.minHeightM, out.cLng, out.cLat, out.groundM].map((a) => a.buffer as ArrayBuffer) };
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
    const groundM = new Float32Array(decoded.count);
    if (decoded.count > 0) {
      const need = new Map<string, TileCoord>();
      for (let i = 0; i < decoded.count; i++) {
        const t = tileAt({ lng: decoded.cLng[i], lat: decoded.cLat[i] }, POINT_ZOOM);
        need.set(tileKey(t.z, t.x, t.y), t);
      }
      // oxlint-disable-next-line no-await-in-loop -- one DEM wait per streamed tile
      await dem.loadAll([...need.values()]);
      for (let i = 0; i < decoded.count; i++) groundM[i] = elevationAt(dem, decoded.cLng[i], decoded.cLat[i], POINT_ZOOM);
    }
    if (latest !== req.id) return;
    const { batch, transfer } = withGround(decoded, groundM);
    scope.postMessage({ kind: BuildingsKind.Tiles, id: req.id, batch } satisfies BuildingsResponse, transfer);
    sent++;
  }
  if (latest !== req.id) return;
  scope.postMessage({ kind: BuildingsKind.Done, id: req.id, tiles: sent, missing } satisfies BuildingsResponse);
}

scope.addEventListener('message', (e: MessageEvent<TilesRequest>) => {
  const req = e.data;
  latest = req.id;
  run(req).catch((err: unknown) => {
    if (latest !== req.id) return;
    const error = err instanceof Error ? err.message : String(err);
    scope.postMessage({ kind: BuildingsKind.Error, id: req.id, error } satisfies BuildingsResponse);
  });
});
