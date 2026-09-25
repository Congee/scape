import { ancestorTile, DEM_MAX_M, DEM_MIN_M, overzoomTile, type DemTile } from '@core/terrain/dem';
import { decodePng } from '@core/terrain/png';
import { encodeRgbaPng } from '@core/terrain/pngEncode';
import { encodeTerrarium } from '@core/terrain/terrarium';
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
  if (got) {
    const dem = await decodeTerrainTile(got.data);
    // A tile with no valid post at all is data we do not have, so it falls back like a 404.
    if (dem.repaired < dem.size * dem.size) return { ...dem, cacheControl: got.cacheControl, expires: got.expires };
  }
  const { size, elev, repaired } = await overzoom(c);
  return { size, elev, repaired: repaired ?? 0 };
}

/**
 * Encoded bytes for MapLibre's own decode, where WebCodecs is missing: a tile with a valid post
 * verbatim, anything else rebuilt from its nearest ancestor.
 */
export async function loadDemBytes(c: TileCoord, signal?: AbortSignal): Promise<FetchedTile> {
  const got = await fetchTile(c, signal);
  // A tile with no valid post at all falls back like a 404 rather than drawing a -32768 m pit.
  if (got && (await hasValidPost(got.data))) return got;
  const tile = await overzoom(c);
  return { data: encodeRgbaPng(encodeTerrarium(tile.elev, tile.size), tile.size, tile.size).buffer as ArrayBuffer };
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
 * Whether any post of an encoded tile is inside the envelope, read raw to skip the repair pass.
 * `true` where only a full decode could tell, which leaves the verdict to MapLibre's own decode.
 */
export async function hasValidPost(data: ArrayBuffer): Promise<boolean> {
  let png;
  try {
    png = await decodePng(new Uint8Array(data));
  } catch {
    return true;
  }
  const { data: px, channels } = png;
  if (channels < 3) return true;
  for (let p = 0; p < px.length; p += channels) {
    const m = px[p] * 256 + px[p + 1] + px[p + 2] / 256 - 32768;
    if (m >= DEM_MIN_M && m <= DEM_MAX_M) return true;
  }
  return false;
}

/**
 * Coverage bottoms out at a different zoom in every region, and MapLibre has no overzoom of its
 * own, so a tile past the bottom is resampled from the nearest ancestor that does resolve. A tile
 * absent at every level is absent everywhere — open ocean — and must stay an error, not a flat sea.
 * An ancestor that fails transiently rejects rather than being skipped, so the tile is re-requested
 * later instead of settling on a coarser ancestor until reload.
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
 * `null` is a settled absence; a transient failure rejects.
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
  const p = decodeAncestor(c);
  p.catch(() => {
    if (ancestors.get(k) === p) ancestors.delete(k);
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
