import { TileType } from 'pmtiles';
import { describe, expect, it } from 'vitest';
import { ArchiveKind } from '@workers/region.protocol';
import { archiveKindOf } from './opfs';

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
});
