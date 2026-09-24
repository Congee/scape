import { describe, expect, it } from 'vitest';
import { ArchiveKind, type ArchiveMeta } from '@workers/region.protocol';
import { basemapGroup, BasemapGroup, BasemapKind, BUILTIN_BASEMAPS, offlineBasemaps, PmFlavor } from './basemaps';

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

  it('serves archives packed with a style from their cached copy', () => {
    const out = offlineBasemaps([{ ...meta('o', ArchiveKind.Basemap), style: 'https://tiles.openfreemap.org/styles/liberty' }], PmFlavor.Dark);
    expect(out[0]).toEqual({ id: 'opfs:o', name: 'Region o', kind: BasemapKind.Style, url: 'scape-asset://o/style.json' });
    expect(basemapGroup(out[0])).toBe(BasemapGroup.Downloaded);
  });
});

const byId = (id: string) => BUILTIN_BASEMAPS.find((b) => b.id === id)!;

describe('basemapGroup', () => {
  it('groups the built-in vector styles and rasters apart', () => {
    expect(basemapGroup(byId('ofm-liberty'))).toBe(BasemapGroup.Vector);
    expect(basemapGroup(byId('osm'))).toBe(BasemapGroup.Raster);
    expect(basemapGroup(byId('opentopo'))).toBe(BasemapGroup.Raster);
  });

  it('groups OPFS archives as downloaded', () => {
    expect(basemapGroup(offlineBasemaps([meta('a', ArchiveKind.Basemap)], PmFlavor.Light)[0])).toBe(BasemapGroup.Downloaded);
  });

  it('groups added and local basemaps as custom', () => {
    expect(basemapGroup({ id: 'pm:https://x/y.pmtiles', name: 'y', kind: BasemapKind.Pmtiles, url: 'https://x/y.pmtiles' })).toBe(BasemapGroup.Custom);
    expect(basemapGroup({ id: 'file:k', name: 'k', kind: BasemapKind.Pmtiles, url: 'k', local: true })).toBe(BasemapGroup.Custom);
  });
});
