import { VectorTile } from '@mapbox/vector-tile';
import { FetchSource, PMTiles } from 'pmtiles';
import { PbfReader } from 'pbf';
import { decodeBuildings, type DecodedBuildings, type VectorLayerLike } from '@core/geo/buildingTiles';
import { tileKey, type TileCoord } from '@core/terrain/tiles';

export const OVERTURE_BUILDINGS_RELEASE = '2026-08-19.0';
export const OVERTURE_BUILDINGS_URL = `https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/${OVERTURE_BUILDINGS_RELEASE}/buildings.pmtiles`;
export const BUILDINGS_ATTRIBUTION = '© OpenStreetMap contributors, © Overture Maps Foundation';

const MAX_CACHED_TILES = 128;
const CONCURRENCY = 6;

export type { DecodedBuildings };

/** The 180 GB planet archive is never downloaded: tiles are read with HTTP range requests. */
const archive = new PMTiles(new FetchSource(OVERTURE_BUILDINGS_URL));

const cache = new Map<string, DecodedBuildings>();
const inflight = new Map<string, Promise<DecodedBuildings | null>>();
const waiting: (() => void)[] = [];
let active = 0;

function touch(key: string, batch: DecodedBuildings): void {
  cache.delete(key);
  cache.set(key, batch);
  while (cache.size > MAX_CACHED_TILES) cache.delete(cache.keys().next().value!);
}

async function acquire(): Promise<void> {
  if (active < CONCURRENCY) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
}

function release(): void {
  active--;
  waiting.shift()?.();
}

async function load(tile: TileCoord, key: string): Promise<DecodedBuildings | null> {
  await acquire();
  try {
    const res = await archive.getZxy(tile.z, tile.x, tile.y);
    if (!res) return null;
    const { layers } = new VectorTile(new PbfReader(new Uint8Array(res.data)));
    const batch = decodeBuildings(layers.building as VectorLayerLike | undefined, layers.building_part as VectorLayerLike | undefined, tile);
    touch(key, batch);
    return batch;
  } catch {
    return null;
  } finally {
    release();
  }
}

/** Decoded `building` and `building_part` layers of one tile; null when the tile is empty or the network fails. */
export function fetchBuildingBatch(tile: TileCoord): Promise<DecodedBuildings | null> {
  const key = tileKey(tile.z, tile.x, tile.y);
  const hit = cache.get(key);
  if (hit) {
    touch(key, hit);
    return Promise.resolve(hit);
  }
  let p = inflight.get(key);
  if (!p) {
    p = load(tile, key).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}
