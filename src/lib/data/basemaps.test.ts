import { describe, expect, it } from 'vitest';
import { ArchiveKind, type ArchiveMeta } from '@workers/region.protocol';
import { BasemapKind, offlineBasemaps, PmFlavor } from './basemaps';

const meta = (id: string, kind: ArchiveKind): ArchiveMeta => ({
  id,
  name: `Region ${id}`,
  kind,
  bbox: { west: 7, south: 45, east: 8, north: 46 },
  minZoom: 0,
  maxZoom: 12,
  bytes: 1000,
  tileCount: 10,
  sourceUrl: 'https://build.protomaps.com/20260912.pmtiles',
  downloadedAt: '2026-09-12T00:00:00.000Z'
});

describe('offlineBasemaps', () => {
  it('maps basemap archives to OPFS-backed pmtiles basemaps', () => {
    const out = offlineBasemaps([meta('a', ArchiveKind.Basemap), meta('b', ArchiveKind.Terrain)], PmFlavor.Dark);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'opfs:a', name: 'Region a', kind: BasemapKind.Pmtiles, url: 'opfs/a.pmtiles', flavor: PmFlavor.Dark });
  });
});
