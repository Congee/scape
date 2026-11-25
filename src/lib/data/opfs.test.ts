import { TileType } from 'pmtiles';
import { describe, expect, it } from 'vitest';
import { ArchiveKind } from '@workers/region.protocol';
import { archiveKindOf, archiveMeta } from './opfs';

describe('archiveKindOf', () => {
  it('tells a buildings extract from a basemap by its layers', () => {
    expect(archiveKindOf(TileType.Mvt, ['building', 'building_part'])).toBe(ArchiveKind.Buildings);
    expect(archiveKindOf(TileType.Mvt, ['building', 'roads', 'water'])).toBe(ArchiveKind.Basemap);
    expect(archiveKindOf(TileType.Mvt, [])).toBe(ArchiveKind.Basemap);
  });

  it('reads raster archives as terrain', () => {
    expect(archiveKindOf(TileType.Png, [])).toBe(ArchiveKind.Terrain);
    expect(archiveKindOf(TileType.Webp, ['building'])).toBe(ArchiveKind.Terrain);
  });

  it('reads JPEG archives as satellite imagery', () => {
    expect(archiveKindOf(TileType.Jpeg, [])).toBe(ArchiveKind.Satellite);
  });
});

describe('archiveMeta', () => {
  const meta = { id: 'a', name: 'A', kind: ArchiveKind.Terrain, bbox: { west: 1, south: 2, east: 3, north: 4 }, minZoom: 0, maxZoom: 12, bytes: 9, tileCount: 3, sourceUrl: 'u', downloadedAt: '2026-01-01T00:00:00Z' };

  it('reads a good sidecar and refuses a damaged one', () => {
    expect(archiveMeta(meta)).toEqual(meta);
    expect(archiveMeta({ ...meta, style: 's', extra: 1 })).toEqual({ ...meta, style: 's' });
    for (const bad of [null, 'x', { ...meta, kind: 'roads' }, { ...meta, downloadedAt: 5 }, { ...meta, bbox: [1, 2, 3, 4] }]) expect(archiveMeta(bad)).toBeUndefined();
  });
});
