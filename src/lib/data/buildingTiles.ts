import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { decodeBuildings, type VectorLayerLike } from '@core/geo/buildingTiles';
import { tileKey, type TileCoord } from '@core/terrain/tiles';
import type { BuildingBatch } from '@workers/buildings.protocol';

export const BUILDINGS_TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
export const BUILDINGS_ATTRIBUTION = '© OpenStreetMap contributors, OpenFreeMap';

const MAX_CACHED_TILES = 128;
const CONCURRENCY = 6;

export type DecodedBuildings = Omit<BuildingBatch, 'groundM'>;

let tilesTemplate: Promise<string> | null = null;

/** TileJSON is fetched once; the release path in `tiles[0]` changes with every planet build. */
function templateUrl(): Promise<string> {
  tilesTemplate ??= fetch(BUILDINGS_TILEJSON_URL)
    .then((r) => (r.ok ? (r.json() as Promise<{ tiles?: string[] }>) : Promise.reject(new Error(`TileJSON ${r.status}`))))
    .then((j) => {
      const t = j.tiles?.[0];
      if (!t) throw new Error('TileJSON has no tiles template');
      return t;
    })
    .catch((e: unknown) => {
      tilesTemplate = null;
      throw e;
    });
  return tilesTemplate;
}

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
    const url = (await templateUrl()).replace('{z}', String(tile.z)).replace('{x}', String(tile.x)).replace('{y}', String(tile.y));
    const res = await fetch(url);
    if (!res.ok) return null;
    const layer = new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer()))).layers.building as VectorLayerLike | undefined;
    const batch = decodeBuildings(layer ?? { length: 0, extent: 4096, feature: () => ({ properties: {}, loadGeometry: () => [] }) }, tile);
    touch(key, batch);
    return batch;
  } catch {
    return null;
  } finally {
    release();
  }
}

/** Decoded `building` layer of one tile; null when it is absent, 404s or the network fails. */
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
