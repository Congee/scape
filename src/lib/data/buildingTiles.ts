import { VectorTile } from '@mapbox/vector-tile';
import { FetchSource, PMTiles } from 'pmtiles';
import { PbfReader } from 'pbf';
import { decodeBuildings, type DecodedBuildings, type VectorLayerLike } from '@core/geo/buildingTiles';
import { tileKey, type TileCoord } from '@core/terrain/tiles';
import { localBuildings, readThrough } from './localTiles';
import { yieldTurn } from './yieldTurn';

export const OVERTURE_BUILDINGS_RELEASE = '2026-08-19.0';
export const OVERTURE_BUILDINGS_URL = `https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/${OVERTURE_BUILDINGS_RELEASE}/buildings.pmtiles`;
export const BUILDINGS_ATTRIBUTION = '© OpenStreetMap contributors, © Overture Maps Foundation';

let maxCachedTiles = 128;
const CONCURRENCY = 12;

/** The mask worker holds its own copy of this module, so it sizes the cache for the map rect. */
export function setBuildingTileCacheSize(n: number): void {
  maxCachedTiles = n;
}

export type { DecodedBuildings };

/** The 180 GB planet archive is never downloaded whole: tiles are read with HTTP range requests. */
let archive = new PMTiles(new FetchSource(OVERTURE_BUILDINGS_URL));

/** Decompressed MVT bytes of one tile: an offline region first, the live archive otherwise; null when empty. */
export function buildingTileBytes(z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer | null> {
  return readThrough(
    () => localBuildings.tile(z, x, y),
    async () => {
      try {
        return (await archive.getZxy(z, x, y, signal))?.data ?? null;
      } catch (e) {
        // pmtiles keeps a rejected header or directory, so a fetch made offline would fail for good.
        if (!signal?.aborted) archive = new PMTiles(new FetchSource(OVERTURE_BUILDINGS_URL));
        throw e;
      }
    }
  );
}

const cache = new Map<string, DecodedBuildings>();
/** A fetch and the callers still waiting on it; one nobody wants is dropped before it hits the network or aborted on it. */
interface Inflight {
  p: Promise<DecodedBuildings | null>;
  wants: (() => boolean)[];
  abort: AbortController;
}
const inflight = new Map<string, Inflight>();
const waiting: (() => void)[] = [];
let active = 0;

function touch(key: string, batch: DecodedBuildings): void {
  cache.delete(key);
  cache.set(key, batch);
  while (cache.size > maxCachedTiles) cache.delete(cache.keys().next().value!);
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

async function load(tile: TileCoord, key: string, f: Inflight): Promise<DecodedBuildings | null> {
  await acquire();
  try {
    // A Stop queued behind busy work must land before a freed slot fetches.
    await yieldTurn();
    if (f.abort.signal.aborted || !f.wants.some((w) => w())) return null;
    const data = await buildingTileBytes(tile.z, tile.x, tile.y, f.abort.signal);
    if (!data) return null;
    const { layers } = new VectorTile(new PbfReader(new Uint8Array(data)));
    const batch = decodeBuildings(layers.building as VectorLayerLike | undefined, layers.building_part as VectorLayerLike | undefined, tile);
    touch(key, batch);
    return batch;
  } catch {
    return null;
  } finally {
    release();
  }
}

/** Decoded `building` and `building_part` layers of one tile; null when the tile is empty, the network fails, or no caller `wanted` it by the time a slot freed. */
export function fetchBuildingBatch(tile: TileCoord, wanted: () => boolean = () => true): Promise<DecodedBuildings | null> {
  const key = tileKey(tile.z, tile.x, tile.y);
  const hit = cache.get(key);
  if (hit) {
    touch(key, hit);
    return Promise.resolve(hit);
  }
  const f = inflight.get(key);
  if (f) {
    f.wants.push(wanted);
    return f.p;
  }
  const e: Inflight = { p: Promise.resolve(null), wants: [wanted], abort: new AbortController() };
  e.p = load(tile, key, e).finally(() => {
    if (inflight.get(key) === e) inflight.delete(key);
  });
  inflight.set(key, e);
  return e.p;
}

/** Aborts every fetch no caller still wants; their callers get null. */
export function abandonBuildingFetches(): void {
  for (const [key, e] of inflight) {
    if (e.wants.some((w) => w())) continue;
    inflight.delete(key);
    e.abort.abort();
  }
}
