import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import { tileCountInBounds, tileIdsInBounds } from '@core/tiles/pmtiles';
import {
  BASEMAP_DEFAULT_MAX_TILES,
  OFM_ATTRIBUTION,
  assetUrl,
  basemapByDefault,
  buildOfTemplate,
  glyphUrls,
  isPmtilesUrl,
  localStyle,
  packZooms,
  parseAssetUrl,
  parseTileJson,
  spriteUrls,
  styleFontstacks,
  tileUrl
} from './openfreemap';

const HOBOKEN = { west: -74.045, south: 40.735, east: -74.02, north: 40.755 };

const liberty = (): StyleSpecification => ({
  version: 8,
  sources: {
    openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
    ne2_shaded: { type: 'raster', tiles: ['https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'], maxzoom: 6 }
  },
  sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#f8f4f0' } },
    { id: 'natural_earth', type: 'raster', source: 'ne2_shaded' },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
    { id: 'road_label', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', layout: { 'text-font': ['Noto Sans Regular'] } },
    {
      id: 'place',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      layout: { 'text-font': ['case', ['==', ['get', 'rank'], 1], ['literal', ['Noto Sans Bold']], ['literal', ['Noto Sans Italic']]] }
    }
  ]
});

describe('OpenFreeMap TileJSON', () => {
  const tj = {
    tiles: ['https://tiles.openfreemap.org/planet/20260913_164504_pt/{z}/{x}/{y}.pbf'],
    minzoom: 0,
    maxzoom: 14,
    vector_layers: [{ id: 'water' }]
  };

  it('resolves the dated tile template instead of assuming one', () => {
    const src = parseTileJson(tj, 'https://tiles.openfreemap.org/planet');
    expect(src.template).toBe('https://tiles.openfreemap.org/planet/20260913_164504_pt/{z}/{x}/{y}.pbf');
    expect(src.build).toBe('2026-09-13');
    expect(src.maxZoom).toBe(14);
    expect(src.vectorLayers).toEqual([{ id: 'water' }]);
    expect(src.attribution).toBe(OFM_ATTRIBUTION);
    expect(tileUrl(src.template, 14, 4824, 6156)).toBe('https://tiles.openfreemap.org/planet/20260913_164504_pt/14/4824/6156.pbf');
  });

  it('resolves relative templates and rejects documents without tiles', () => {
    expect(parseTileJson({ tiles: ['t/{z}/{x}/{y}.pbf'] }, 'https://example.com/tj/index.json').template).toBe('https://example.com/tj/t/{z}/{x}/{y}.pbf');
    expect(() => parseTileJson({ tiles: [] }, 'https://example.com/')).toThrow();
    expect(buildOfTemplate('https://example.com/{z}/{x}/{y}.pbf')).toBeNull();
  });

  it('tells archive URLs from TileJSON ones', () => {
    expect(isPmtilesUrl('https://build.protomaps.com/20260912.pmtiles')).toBe(true);
    expect(isPmtilesUrl('https://tiles.openfreemap.org/planet')).toBe(false);
  });
});

describe('OpenFreeMap tile enumeration', () => {
  it('mirrors the basemap zoom policy within the source range', () => {
    expect(packZooms(0, 15, { minZoom: 0, maxZoom: 14 })).toEqual([0, 14]);
    expect(packZooms(0, 12, { minZoom: 0, maxZoom: 14 })).toEqual([0, 12]);
  });

  it('joins the terrain download by default only up to the tile cap', () => {
    const nyc = { west: -74.3, south: 40.5, east: -73.7, north: 40.95 };
    expect(basemapByDefault(HOBOKEN, 14)).toBe(true);
    expect(tileCountInBounds(nyc, 0, 14)).toBeGreaterThan(BASEMAP_DEFAULT_MAX_TILES);
    expect(basemapByDefault(nyc, 14)).toBe(false);
    expect(basemapByDefault(nyc, 10)).toBe(true);
  });

  it('packs Hoboken to z14 in at most 50 tiles', () => {
    const ids = tileIdsInBounds(HOBOKEN, 0, 14);
    expect(ids.length).toBe(tileCountInBounds(HOBOKEN, 0, 14));
    expect(ids.length).toBeLessThanOrEqual(50);
    expect(ids.length).toBeGreaterThanOrEqual(15);
  });
});

describe('OpenFreeMap style assets', () => {
  it('collects font stacks from plain and expression text-font', () => {
    expect(styleFontstacks(liberty())).toEqual(['Noto Sans Bold', 'Noto Sans Italic', 'Noto Sans Regular']);
  });

  it('lists glyph ranges and sprite sheets to cache', () => {
    const g = glyphUrls(liberty().glyphs!, ['Noto Sans Bold'], ['0-255']);
    expect(g).toEqual([{ url: 'https://tiles.openfreemap.org/fonts/Noto%20Sans%20Bold/0-255.pbf', path: 'fonts/Noto Sans Bold/0-255.pbf' }]);
    expect(spriteUrls(liberty().sprite).map((s) => s.path)).toEqual(['sprite.json', 'sprite.png', 'sprite@2x.json', 'sprite@2x.png']);
    expect(spriteUrls([{ id: 'a', url: 'https://x/a' }])[0]).toEqual({ url: 'https://x/a.json', path: 'sprite-a.json' });
  });

  it('rewrites the style onto the archive and asset cache', () => {
    const s = localStyle(liberty(), 'r1', 'attr');
    expect(s.sources).toEqual({ openmaptiles: { type: 'vector', url: 'pmtiles://opfs/r1.pmtiles', attribution: 'attr' } });
    expect(s.layers.map((l) => l.id)).toEqual(['background', 'water', 'road_label', 'place']);
    expect(s.sprite).toBe('scape-asset://r1/sprite');
    expect(s.glyphs).toBe('scape-asset://r1/fonts/{fontstack}/{range}.pbf');
  });

  it('round-trips asset URLs as MapLibre requests them', () => {
    const url = s(assetUrl('r1', 'fonts/{fontstack}/{range}.pbf'));
    expect(parseAssetUrl(url)).toEqual({ id: 'r1', path: 'fonts/Noto Sans Regular,Noto Sans Bold/0-255.pbf' });
    expect(parseAssetUrl('scape-asset://r1/sprite@2x.json')).toEqual({ id: 'r1', path: 'sprite@2x.json' });
    expect(parseAssetUrl('https://x/y')).toBeNull();
  });
});

// MapLibre substitutes the raw stack name; URL parsing may escape the spaces.
const s = (t: string) => t.replace('{fontstack}', 'Noto%20Sans%20Regular,Noto%20Sans%20Bold').replace('{range}', '0-255');
