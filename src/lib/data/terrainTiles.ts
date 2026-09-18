import { decodeTerrarium, overzoomTile, type DemSource, type DemTile } from '@core/terrain/dem';
import { decodePng, UnsupportedPngError } from '@core/terrain/png';
import { tileKey, type TileCoord } from '@core/terrain/tiles';
import { localTerrain } from './localTiles';

export const TerrainSourceId = {
  /** swissALTI3D over the Alps, 512 px lossless WebP; coverage bottoms out at a different zoom per region. */
  Mapterhorn: 'mapterhorn',
  Aws: 'aws'
} as const;
export type TerrainSourceId = (typeof TerrainSourceId)[keyof typeof TerrainSourceId];

interface TerrainSourceSpec {
  url: string;
  mime: string;
  tileSize: number;
  maxZoom: number;
  attribution: string;
  /** Rough mean tile size, for offline download estimates only. */
  tileBytes: number;
}

const SOURCES: Record<TerrainSourceId, TerrainSourceSpec> = {
  [TerrainSourceId.Mapterhorn]: {
    url: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp',
    mime: 'image/webp',
    tileSize: 512,
    maxZoom: 17,
    attribution: 'Terrain: <a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
    tileBytes: 200_000
  },
  [TerrainSourceId.Aws]: {
    url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    mime: 'image/png',
    tileSize: 256,
    maxZoom: 15,
    attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a> (Mapzen, AWS Open Data)',
    tileBytes: 60_000
  }
};

/** WebP needs WebCodecs: canvas decode is lossy for terrarium, so without it we take the PNG source. */
export const TERRAIN_SOURCE_ID: TerrainSourceId = typeof ImageDecoder === 'undefined' ? TerrainSourceId.Aws : TerrainSourceId.Mapterhorn;
const source = SOURCES[TERRAIN_SOURCE_ID];

export const TERRAIN_TILE_URL = source.url;
export const TERRAIN_TILE_MIME = source.mime;
export const TERRAIN_TILE_SIZE = source.tileSize;
export const TERRAIN_MAX_ZOOM = source.maxZoom;
export const TERRAIN_ATTRIBUTION = source.attribution;
export const TERRAIN_TILE_BYTES = source.tileBytes;
/** MapLibre reads DEM tiles through our own protocol so downloaded regions win over the network. */
export const DEM_TILE_TEMPLATE = 'scape-dem://{z}/{x}/{y}';

/** A zoom stated in 256 px terms, restated for the active source's tile size. */
export const demZoom = (zoom256: number): number => zoom256 - Math.log2(TERRAIN_TILE_SIZE / 256);

/** Entry count for a cache sized in 256 px tiles; one 512 px tile covers the ground of four. */
export const demCacheTiles = (tiles256: number): number => Math.max(1, Math.round(tiles256 / (TERRAIN_TILE_SIZE / 256) ** 2));

/** Point elevations for the alignment worker's own surface; about 5–9 m per pixel at mid-latitudes. */
export const POINT_ZOOM = demZoom(14);

export function terrainTileUrl(z: number, x: number, y: number): string {
  return TERRAIN_TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

export interface DecodedDem {
  size: number;
  elev: Float32Array;
  repaired: number;
}

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

/** Dispatches on the container so an offline archive downloaded from either source still decodes. */
export function decodeTerrainTile(data: ArrayBuffer): Promise<DecodedDem> {
  const bytes = new Uint8Array(data);
  return isPng(bytes) ? decodeTerrainPng(bytes) : decodeTerrainWebp(data);
}

/**
 * Decodes a Terrarium PNG to metres. Bytes are decoded by hand because canvas readback is
 * not lossless (a one-unit red error is 256 m); the canvas only serves unusual PNG variants.
 */
export async function decodeTerrainPng(bytes: Uint8Array<ArrayBuffer>): Promise<DecodedDem> {
  try {
    const png = await decodePng(bytes);
    return { size: png.width, ...decodeTerrarium(png.data, png.width, png.channels) };
  } catch (e) {
    if (!(e instanceof UnsupportedPngError)) throw e;
  }
  const bmp = await createImageBitmap(new Blob([bytes]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  try {
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    return { size: bmp.width, ...decodeTerrarium(ctx.getImageData(0, 0, bmp.width, bmp.height).data, bmp.width, 4) };
  } finally {
    bmp.close();
  }
}

/**
 * Decodes a Terrarium WebP to metres through WebCodecs. Canvas is not an option here at all:
 * its readback flips red by a unit on some pixels, which in terrarium is a 256 m spike.
 * The frame's native layout is BGRX; `copyTo` with an explicit RGBA format normalises it.
 */
export async function decodeTerrainWebp(data: ArrayBuffer): Promise<DecodedDem> {
  const dec = new ImageDecoder({ data, type: 'image/webp' });
  let image: VideoFrame | undefined;
  try {
    ({ image } = await dec.decode());
    const out = new Uint8Array(image.allocationSize({ format: 'RGBA' }));
    await image.copyTo(out, { format: 'RGBA' });
    const size = image.displayWidth;
    return { size, ...decodeTerrarium(out, size, 4) };
  } finally {
    // A leaked VideoFrame pins GPU memory.
    image?.close();
    dec.close();
  }
}

/** The source has no tile there; distinct from a transient failure, which is never cached. */
const ABSENT = Symbol('absent');

/** In-memory LRU of decoded tiles with de-duplicated, concurrency-limited fetches. */
export class DemCache implements DemSource {
  private tiles = new Map<string, DemTile | null>();
  private inflight = new Map<string, Promise<DemTile | null>>();
  private absent = new Set<string>();
  private waiting: (() => void)[] = [];
  private active = 0;

  constructor(
    private maxTiles = 200,
    private concurrency = 12
  ) {}

  get(z: number, x: number, y: number): DemTile | null | undefined {
    const k = tileKey(z, x, y);
    const t = this.tiles.get(k);
    if (t !== undefined) {
      // Re-insert so Map order doubles as recency.
      this.tiles.delete(k);
      this.tiles.set(k, t);
    }
    return t;
  }

  load(c: TileCoord): Promise<DemTile | null> {
    const k = tileKey(c.z, c.x, c.y);
    const have = this.tiles.get(k);
    if (have !== undefined) return Promise.resolve(have);
    let p = this.inflight.get(k);
    if (!p) {
      p = this.fetchTile(c).finally(() => this.inflight.delete(k));
      this.inflight.set(k, p);
    }
    return p;
  }

  async loadAll(coords: TileCoord[]): Promise<void> {
    await Promise.all(coords.map((c) => this.load(c)));
  }

  /**
   * Coverage bottoms out at a different zoom in every region, so a tile the source does not have
   * is resampled from its deepest existing ancestor rather than left as a hole. The absence is
   * remembered so an evicted overzoom does not re-probe the network for a tile known to be missing.
   */
  private async fetchTile(c: TileCoord): Promise<DemTile | null> {
    const k = tileKey(c.z, c.x, c.y);
    if (!this.absent.has(k)) {
      const got = await this.fetchDirect(c);
      if (got !== ABSENT) return got;
      this.absent.add(k);
    }
    // Recurses through load, so an ancestor is fetched once however many descendants want it.
    const parent = c.z > 0 ? await this.load({ z: c.z - 1, x: c.x >> 1, y: c.y >> 1 }) : null;
    if (!parent) {
      this.set(c, null);
      return null;
    }
    const tile = overzoomTile(parent, c);
    this.set(c, tile);
    return tile;
  }

  private async fetchDirect(c: TileCoord): Promise<DemTile | null | typeof ABSENT> {
    await this.acquire();
    try {
      const local = await localTerrain.tile(c.z, c.x, c.y);
      let data: ArrayBuffer;
      if (local) data = local;
      else {
        const res = await fetch(terrainTileUrl(c.z, c.x, c.y));
        if (res.status === 404 || res.status === 403) return ABSENT;
        if (!res.ok) return null;
        data = await res.arrayBuffer();
      }
      const { size, elev, repaired } = await decodeTerrainTile(data);
      // A tile with no valid post at all is data we do not have, so hand it to the missing-tile path.
      if (repaired >= size * size) {
        this.set(c, null);
        return null;
      }
      const tile: DemTile = { ...c, size, elev, repaired };
      this.set(c, tile);
      return tile;
    } catch {
      // Network hiccups are not cached, so the next request retries.
      return null;
    } finally {
      this.release();
    }
  }

  private set(c: TileCoord, t: DemTile | null) {
    this.tiles.set(tileKey(c.z, c.x, c.y), t);
    while (this.tiles.size > this.maxTiles) {
      const oldest = this.tiles.keys().next().value;
      if (oldest === undefined) break;
      this.tiles.delete(oldest);
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) =>
      this.waiting.push(() => {
        this.active++;
        resolve();
      })
    );
  }

  private release() {
    this.active--;
    this.waiting.shift()?.();
  }
}
