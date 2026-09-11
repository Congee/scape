import { decodeTerrarium, type DemSource, type DemTile } from '@core/terrain/dem';
import { decodePng, UnsupportedPngError } from '@core/terrain/png';
import { tileKey, type TileCoord } from '@core/terrain/tiles';

export const TERRAIN_TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const TERRAIN_MAX_ZOOM = 15;
export const TERRAIN_ATTRIBUTION =
  'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a> (Mapzen, AWS Open Data)';
/** Zoom used for point elevations; about 5–9 m per pixel at mid-latitudes. */
export const POINT_ZOOM = 14;

export function terrainTileUrl(z: number, x: number, y: number): string {
  return TERRAIN_TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

export interface DecodedDem {
  size: number;
  elev: Float32Array;
}

/**
 * Decodes a Terrarium PNG to metres. Bytes are decoded by hand because canvas readback is
 * not lossless (a one-unit red error is 256 m); the canvas only serves unusual PNG variants.
 */
export async function decodeTerrainPng(blob: Blob): Promise<DecodedDem> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  try {
    const png = await decodePng(bytes);
    return { size: png.width, elev: decodeTerrarium(png.data, png.width, png.channels) };
  } catch (e) {
    if (!(e instanceof UnsupportedPngError)) throw e;
  }
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  try {
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    return { size: bmp.width, elev: decodeTerrarium(ctx.getImageData(0, 0, bmp.width, bmp.height).data, bmp.width) };
  } finally {
    bmp.close();
  }
}

/** In-memory LRU of decoded tiles with de-duplicated, concurrency-limited fetches. */
export class DemCache implements DemSource {
  private tiles = new Map<string, DemTile | null>();
  private inflight = new Map<string, Promise<DemTile | null>>();
  private waiting: (() => void)[] = [];
  private active = 0;

  constructor(
    private maxTiles = 200,
    private concurrency = 6
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

  private async fetchTile(c: TileCoord): Promise<DemTile | null> {
    await this.acquire();
    try {
      const res = await fetch(terrainTileUrl(c.z, c.x, c.y));
      if (res.status === 404 || res.status === 403) {
        this.set(c, null);
        return null;
      }
      if (!res.ok) return null;
      const { size, elev } = await decodeTerrainPng(await res.blob());
      const tile: DemTile = { ...c, size, elev };
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
