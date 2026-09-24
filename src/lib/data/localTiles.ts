/** Tiles served from downloaded OPFS archives, before any network. Worker-safe. */

import { PMTiles } from 'pmtiles';
import { bboxFromCorners, bboxIntersects } from '@core/geo/bbox';
import { tilePixelToLngLat, TILE_SIZE } from '@core/terrain/tiles';
import { ArchiveKind, type ArchiveMeta } from '@workers/region.protocol';
import { ARCHIVES_CHANNEL, listArchives, opfsSupported, OpfsSource } from './opfs';

export interface LocalArchive {
  meta: ArchiveMeta;
  pm: Pick<PMTiles, 'getZxy'>;
}

const openArchives = async (kind: ArchiveKind): Promise<LocalArchive[]> =>
  (await listArchives()).filter((m) => m.kind === kind).map((meta) => ({ meta, pm: new PMTiles(new OpfsSource(meta.id)) }));

/** Downloaded archives of one kind; tests inject `open` in place of OPFS. */
export class LocalTiles {
  private ready: Promise<LocalArchive[]> | null = null;
  private listening = false;

  constructor(
    private readonly kind: ArchiveKind,
    private readonly open: (kind: ArchiveKind) => Promise<LocalArchive[]> = openArchives,
    private readonly supported: () => boolean = opfsSupported
  ) {}

  refresh(): void {
    this.ready = null;
  }

  private list(): Promise<LocalArchive[]> {
    // Subscribed lazily so importing the module has no side effects.
    if (!this.listening && typeof BroadcastChannel !== 'undefined') {
      this.listening = true;
      new BroadcastChannel(ARCHIVES_CHANNEL).addEventListener('message', () => this.refresh());
    }
    this.ready ??= this.open(this.kind).catch(() => []);
    return this.ready;
  }

  async tile(z: number, x: number, y: number): Promise<ArrayBuffer | null> {
    if (!this.supported()) return null;
    const archives = await this.list();
    if (!archives.length) return null;
    // The tile's own footprint, not just its centre: a low-zoom tile covering the region is still the region's.
    const footprint = bboxFromCorners(tilePixelToLngLat(z, x, y, 0, 0), tilePixelToLngLat(z, x, y, TILE_SIZE, TILE_SIZE));
    for (const a of archives) {
      if (z < a.meta.minZoom || z > a.meta.maxZoom || !bboxIntersects(a.meta.bbox, footprint)) continue;
      // oxlint-disable-next-line no-await-in-loop -- first archive that has the tile wins
      const res = await a.pm.getZxy(z, x, y).catch(() => undefined);
      if (res) return res.data;
    }
    return null;
  }
}

/** Downloaded regions first; the network is asked only for a tile no region holds. */
export async function readThrough<T>(local: () => Promise<T | null>, remote: () => Promise<T | null>): Promise<T | null> {
  return (await local()) ?? remote();
}

export const localTerrain = new LocalTiles(ArchiveKind.Terrain);
export const localBuildings = new LocalTiles(ArchiveKind.Buildings);
