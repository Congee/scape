import { layers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';
import { ArchiveKind, type ArchiveMeta } from '@workers/region.protocol';

// Values are Protomaps flavor names and are persisted with custom basemaps.
export const PmFlavor = { Light: 'light', Dark: 'dark', White: 'white', Grayscale: 'grayscale', Black: 'black' } as const;
export type PmFlavor = (typeof PmFlavor)[keyof typeof PmFlavor];

// Values are persisted with custom basemaps.
export const BasemapKind = { Style: 'style', Raster: 'raster', Pmtiles: 'pmtiles' } as const;
export type BasemapKind = (typeof BasemapKind)[keyof typeof BasemapKind];

export interface Basemap {
  id: string;
  name: string;
  kind: BasemapKind;
  /** Style URL, raster tile template, or PMTiles URL (or a local file name registered at runtime). */
  url: string;
  attribution?: string;
  maxzoom?: number;
  flavor?: PmFlavor;
  builtin?: boolean;
  /** Backed by a File picked this session; not persisted. */
  local?: boolean;
}

const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ASSETS = 'https://protomaps.github.io/basemaps-assets';
const GLYPHS = `${ASSETS}/fonts/{fontstack}/{range}.pbf`;
const GLYPH_FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
const GLYPH_RANGES = ['0-255', '256-511'];

/** Sprites and Latin glyphs a Protomaps style fetches; the service worker keeps them for offline maps. */
export function styleAssetUrls(flavor: PmFlavor): string[] {
  const sprite = `${ASSETS}/sprites/v4/${flavor}`;
  return [
    ...['', '@2x'].flatMap((s) => [`${sprite}${s}.json`, `${sprite}${s}.png`]),
    ...GLYPH_FONTS.flatMap((f) => GLYPH_RANGES.map((r) => `${ASSETS}/fonts/${encodeURIComponent(f)}/${r}.pbf`))
  ];
}

export const BUILTIN_BASEMAPS: Basemap[] = [
  { id: 'ofm-liberty', name: 'OpenFreeMap Liberty', kind: BasemapKind.Style, url: 'https://tiles.openfreemap.org/styles/liberty', builtin: true },
  { id: 'ofm-bright', name: 'OpenFreeMap Bright', kind: BasemapKind.Style, url: 'https://tiles.openfreemap.org/styles/bright', builtin: true },
  { id: 'ofm-positron', name: 'OpenFreeMap Positron (light)', kind: BasemapKind.Style, url: 'https://tiles.openfreemap.org/styles/positron', builtin: true },
  { id: 'ofm-dark', name: 'OpenFreeMap Dark', kind: BasemapKind.Style, url: 'https://tiles.openfreemap.org/styles/dark', builtin: true },
  { id: 'ofm-fiord', name: 'OpenFreeMap Fiord', kind: BasemapKind.Style, url: 'https://tiles.openfreemap.org/styles/fiord', builtin: true },
  { id: 'osm', name: 'OpenStreetMap (raster)', kind: BasemapKind.Raster, url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM_ATTR, maxzoom: 19, builtin: true },
  {
    id: 'opentopo',
    name: 'OpenTopoMap (raster)',
    kind: BasemapKind.Raster,
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: `${OSM_ATTR}, SRTM · style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
    maxzoom: 17,
    builtin: true
  }
];

export const DEFAULT_BASEMAP_ID = 'ofm-liberty';

function rasterStyle(b: Basemap): StyleSpecification {
  const tiles = b.url.includes('{s}') ? ['a', 'b', 'c'].map((s) => b.url.replace('{s}', s)) : [b.url];
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: { base: { type: 'raster', tiles, tileSize: 256, attribution: b.attribution ?? '', maxzoom: b.maxzoom ?? 19 } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }]
  };
}

function pmtilesStyle(b: Basemap): StyleSpecification {
  const flavor = b.flavor ?? PmFlavor.Light;
  return {
    version: 8,
    glyphs: GLYPHS,
    sprite: `${ASSETS}/sprites/v4/${flavor}`,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${b.url}`,
        attribution: b.attribution ?? `<a href="https://protomaps.com">Protomaps</a> ${OSM_ATTR}`
      }
    },
    layers: layers('protomaps', namedFlavor(flavor), { lang: 'en' })
  };
}

export function styleFor(b: Basemap): string | StyleSpecification {
  switch (b.kind) {
    case BasemapKind.Style:
      return b.url;
    case BasemapKind.Raster:
      return rasterStyle(b);
    case BasemapKind.Pmtiles:
      return pmtilesStyle(b);
  }
}

/** Downloaded basemap archives, as basemaps served from OPFS. */
export function offlineBasemaps(archives: ArchiveMeta[], flavor: PmFlavor): Basemap[] {
  return archives
    .filter((m) => m.kind === ArchiveKind.Basemap)
    .map((m) => ({
      id: `opfs:${m.id}`,
      name: m.name,
      kind: BasemapKind.Pmtiles,
      url: `opfs/${m.id}.pmtiles`,
      flavor,
      attribution: `<a href="https://protomaps.com">Protomaps</a> ${OSM_ATTR}`
    }));
}

export const BasemapGroup = { Vector: 'OpenFreeMap', Raster: 'Raster', Downloaded: 'Downloaded', Custom: 'Custom' } as const;
export type BasemapGroup = (typeof BasemapGroup)[keyof typeof BasemapGroup];

/** Which section of the basemap tree a basemap belongs to. */
export function basemapGroup(b: Basemap): BasemapGroup {
  if (b.id.startsWith('opfs:')) return BasemapGroup.Downloaded;
  if (!b.builtin) return BasemapGroup.Custom;
  return b.kind === BasemapKind.Raster ? BasemapGroup.Raster : BasemapGroup.Vector;
}

/** True when the style paints a dark ground, so overlays can pick contrasting colours. */
export function isDarkBasemap(b: Basemap): boolean {
  return b.id === 'ofm-dark' || b.id === 'ofm-fiord' || b.flavor === PmFlavor.Dark || b.flavor === PmFlavor.Black;
}
