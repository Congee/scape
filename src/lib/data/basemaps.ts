import { layers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';

export type PmFlavor = 'light' | 'dark' | 'white' | 'grayscale' | 'black';

export interface Basemap {
  id: string;
  name: string;
  kind: 'style' | 'raster' | 'pmtiles';
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

export const BUILTIN_BASEMAPS: Basemap[] = [
  { id: 'ofm-liberty', name: 'OpenFreeMap Liberty', kind: 'style', url: 'https://tiles.openfreemap.org/styles/liberty', builtin: true },
  { id: 'ofm-bright', name: 'OpenFreeMap Bright', kind: 'style', url: 'https://tiles.openfreemap.org/styles/bright', builtin: true },
  { id: 'ofm-positron', name: 'OpenFreeMap Positron (light)', kind: 'style', url: 'https://tiles.openfreemap.org/styles/positron', builtin: true },
  { id: 'ofm-dark', name: 'OpenFreeMap Dark', kind: 'style', url: 'https://tiles.openfreemap.org/styles/dark', builtin: true },
  { id: 'ofm-fiord', name: 'OpenFreeMap Fiord', kind: 'style', url: 'https://tiles.openfreemap.org/styles/fiord', builtin: true },
  { id: 'osm', name: 'OpenStreetMap (raster)', kind: 'raster', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM_ATTR, maxzoom: 19, builtin: true },
  {
    id: 'opentopo',
    name: 'OpenTopoMap (raster)',
    kind: 'raster',
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
  const flavor = b.flavor ?? 'light';
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
    case 'style':
      return b.url;
    case 'raster':
      return rasterStyle(b);
    case 'pmtiles':
      return pmtilesStyle(b);
  }
}

/** True when the style paints a dark ground, so overlays can pick contrasting colours. */
export function isDarkBasemap(b: Basemap): boolean {
  return b.id === 'ofm-dark' || b.id === 'ofm-fiord' || b.flavor === 'dark' || b.flavor === 'black';
}
