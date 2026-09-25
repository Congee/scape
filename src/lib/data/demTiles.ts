import { ancestorTile, overzoomTile, type DemTile } from '@core/terrain/dem';
import { tileKey, type TileCoord } from '@core/terrain/tiles';
import { localTerrain } from './localTiles';
import { decodeTerrainTile, terrainTileUrl, type DecodedDem } from './terrainTiles';

/** Levels walked up before a tile counts as genuinely absent rather than past the region's coverage. */
const MAX_OVERZOOM = 5;
/** Decoded ancestors held for the descendants that share them; one 512 px tile is a megabyte of floats. */
const MAX_ANCESTORS = 16;

const ancestors = new Map<string, Promise<DemTile | null>>();

/** A tile's elevations, plus whatever freshness the response it came from stated. */
export interface LoadedDem extends Omit<DecodedDem, 'belowSea'> {
  cacheControl?: string;
  expires?: string;
}

/**
 * Decoded elevations for a tile, by the same route the protocol takes: downloaded regions before
 * the network, resampled from an ancestor past the region's coverage. For readers that want the
 * posts rather than the encoded bytes, so nothing has to re-encode and re-decode a tile.
 */
export async function loadDemTile(c: TileCoord, signal?: AbortSignal): Promise<LoadedDem> {
  const got = await fetchTile(c, signal);
  if (got) return { ...(await decodeTerrainTile(got.data)), cacheControl: got.cacheControl, expires: got.expires };
  const { size, elev, repaired } = await overzoom(c);
  return { size, elev, repaired: repaired ?? 0 };
}

interface FetchedTile {
  data: ArrayBuffer;
  cacheControl?: string;
  expires?: string;
}

/** Encoded tile bytes, downloaded regions before the network; `null` where the source has no tile. */
export async function fetchTile(c: TileCoord, signal?: AbortSignal): Promise<FetchedTile | null> {
  const local = await localTerrain.tile(c.z, c.x, c.y);
  if (local) return { data: local };
  const res = await fetch(terrainTileUrl(c.z, c.x, c.y), { signal });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`Terrain tile ${c.z}/${c.x}/${c.y}: HTTP ${res.status}`);
  return {
    data: await res.arrayBuffer(),
    cacheControl: res.headers.get('Cache-Control') ?? undefined,
    expires: res.headers.get('Expires') ?? undefined
  };
}

/**
 * Coverage bottoms out at a different zoom in every region, and MapLibre has no overzoom of its
 * own, so a tile past the bottom is resampled from the nearest ancestor that does resolve. A tile
 * absent at every level is absent everywhere — open ocean — and must stay an error, not a flat sea.
 */
export async function overzoom(c: TileCoord): Promise<DemTile> {
  for (let z = c.z - 1; z >= Math.max(0, c.z - MAX_OVERZOOM); z--) {
    // oxlint-disable-next-line no-await-in-loop -- the nearest ancestor that resolves wins
    const parent = await ancestor(ancestorTile(c, z));
    if (!parent) continue;
    return overzoomTile(parent, c);
  }
  throw new Error(`Terrain tile ${c.z}/${c.x}/${c.y}: no source coverage`);
}

/**
 * Decoded ancestor, shared by its descendants: a z12 parent has 1024 of them at z17, and each
 * would otherwise refetch and re-decode it. The promise has many waiters, so no caller's abort
 * reaches the fetch, and a failure is dropped from the cache so the next descendant retries.
 */
function ancestor(c: TileCoord): Promise<DemTile | null> {
  const k = tileKey(c.z, c.x, c.y);
  const hit = ancestors.get(k);
  if (hit) {
    // Re-insert so Map order doubles as recency.
    ancestors.delete(k);
    ancestors.set(k, hit);
    return hit;
  }
  const p = decodeAncestor(c).catch(() => {
    ancestors.delete(k);
    return null;
  });
  ancestors.set(k, p);
  while (ancestors.size > MAX_ANCESTORS) {
    const oldest = ancestors.keys().next().value;
    if (oldest === undefined) break;
    ancestors.delete(oldest);
  }
  return p;
}

async function decodeAncestor(c: TileCoord): Promise<DemTile | null> {
  const got = await fetchTile(c);
  if (!got) return null;
  const { size, elev, repaired } = await decodeTerrainTile(got.data);
  // A tile with no valid post at all is data we do not have, so keep walking up.
  return repaired >= size * size ? null : { ...c, size, elev, repaired };
}
