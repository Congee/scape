/** Terrain tiles served from downloaded OPFS archives, before any network. Worker-safe. */

import { PMTiles } from 'pmtiles';
import { bboxFromCorners, bboxIntersects } from '@core/geo/bbox';
import { tilePixelToLngLat, TILE_SIZE } from '@core/terrain/tiles';
import { ArchiveKind, type ArchiveMeta } from '@workers/region.protocol';
import { ARCHIVES_CHANNEL, listArchives, opfsSupported, OpfsSource } from './opfs';

interface LocalArchive {
  meta: ArchiveMeta;
  pm: PMTiles;
}

export class LocalTerrain {
  private ready: Promise<LocalArchive[]> | null = null;

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(ARCHIVES_CHANNEL);
      ch.addEventListener('message', () => this.refresh());
    }
  }

  refresh(): void {
    this.ready = null;
  }

  private list(): Promise<LocalArchive[]> {
    this.ready ??= listArchives()
      .then((metas) => metas.filter((m) => m.kind === ArchiveKind.Terrain).map((meta) => ({ meta, pm: new PMTiles(new OpfsSource(meta.id)) })))
      .catch(() => []);
    return this.ready;
  }

  async tile(z: number, x: number, y: number): Promise<ArrayBuffer | null> {
    if (!opfsSupported()) return null;
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

export const localTerrain = new LocalTerrain();
