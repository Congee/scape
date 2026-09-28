import { describe, expect, it } from 'vitest';
import {
  CachePolicy,
  Coverage,
  SAT_SOURCES,
  SatKind,
  type SatSource,
  SatTier,
  candidates,
  coverageOf,
  creditFor,
  creditsFor,
  fillBlank,
  lacksDetail,
  maskNoData,
  nativeTile,
  noDataShare,
  offlineCandidates,
  offlineSources,
  sourceTileUrl,
  swCacheHosts,
  swCachePattern,
  tileBbox3857,
  tileLngLatBbox,
  whitenBlank,
  wmsGetMapUrl
} from './satellite';

const px = (r: number, g: number, b: number, a: number, n: number) => Array.from({ length: n }, () => [r, g, b, a]).flat();
const bytes = (...v: number[]) => new Uint8ClampedArray(v);
const byId = (id: string) => SAT_SOURCES.find((s) => s.id === id) as SatSource;
const lngLatTile = (lng: number, lat: number, z: number) => {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [z, Math.floor(((lng + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)] as const;
};
const ids = (z: number, x: number, y: number, keys = {}, online = true) => candidates(z, x, y, { keys, online }).map((c) => c.source.id);
const KEYS = { maptiler: 'mt', esri: 'es' };

describe('satellite index', () => {
  it('has unique ids, sane zooms and bboxes only', () => {
    expect(new Set(SAT_SOURCES.map((s) => s.id)).size).toBe(SAT_SOURCES.length);
    for (const s of SAT_SOURCES) {
      expect(s.minZoom).toBeLessThanOrEqual(s.maxZoom);
      expect(s.bboxes.length).toBeGreaterThan(0);
      for (const b of s.bboxes) {
        expect(b.west).toBeLessThan(b.east);
        expect(b.south).toBeLessThan(b.north);
      }
      if (s.kind === SatKind.Wms) expect(s.layers).toBeTruthy();
      expect(s.url.startsWith('https://')).toBe(true);
    }
  });

  it('leaves out Sachsen and key-only national sources', () => {
    const all = SAT_SOURCES.map((s) => s.id).join(' ');
    expect(all).not.toMatch(/sachsen|dk|fi-|linz|nz/);
    expect(SAT_SOURCES.filter((s) => s.key).map((s) => s.id)).toEqual(['maptiler', 'esri']);
  });

  it('marks cache policies as licensed', () => {
    for (const id of ['us-naip', 'nl-pdok', 'ch-swissimage', 'jp-gsi', 'maptiler']) expect(byId(id).cache).toBe(CachePolicy.DeviceCache);
    expect(byId('esri').cache).toBe(CachePolicy.None);
    for (const id of ['fr-ign', 'de-nrw', 'de-bayern', 'at-basemap', 'es-pnoa', 'lu', 'be-brussels', 'pl-gugik', 'de-hamburg']) expect(byId(id).cache).toBe(CachePolicy.Offline);
  });

  it('keeps Esri and device-only sources out of offline packs, Esri out of the SW cache', () => {
    const off = offlineSources().map((s) => s.id);
    expect(off).not.toContain('esri');
    expect(off).not.toContain('maptiler');
    expect(off).not.toContain('nl-pdok');
    expect(off).toContain('de-bayern');
    const hosts = swCacheHosts();
    expect(hosts).not.toContain('ibasemaps-api.arcgis.com');
    expect(hosts).toContain('service.pdok.nl');
    expect(hosts).toContain('wmts{s}.geoportail.lu');
    const re = new RegExp(swCachePattern());
    expect(re.test('https://wmts3.geoportail.lu/opendata/x.jpeg')).toBe(true);
    expect(re.test('https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/1/0/0')).toBe(false);
    expect(re.test('https://service.pdok.nl.evil.com/')).toBe(false);
  });
});

describe('tile geometry and URLs', () => {
  it('gives web-mercator tile bounds', () => {
    const [minX, minY, maxX, maxY] = tileBbox3857(0, 0, 0);
    expect(minX).toBeCloseTo(-20037508.34, 1);
    expect(maxY).toBeCloseTo(20037508.34, 1);
    expect(maxX).toBeCloseTo(-minX, 6);
    expect(minY).toBeCloseTo(-maxY, 6);
    const b = tileLngLatBbox(1, 1, 0);
    expect(b.west).toBe(0);
    expect(b.south).toBeCloseTo(0, 9);
    expect(b.north).toBeCloseTo(85.0511, 3);
  });

  it('builds a WMS 1.3.0 GetMap in EPSG:3857 x,y order', () => {
    const url = new URL(wmsGetMapUrl('https://example.org/wms', 'dop', 1, 1, 1));
    const q = url.searchParams;
    expect(q.get('SERVICE')).toBe('WMS');
    expect(q.get('REQUEST')).toBe('GetMap');
    expect(q.get('VERSION')).toBe('1.3.0');
    expect(q.get('CRS')).toBe('EPSG:3857');
    expect(q.get('LAYERS')).toBe('dop');
    expect(q.get('WIDTH')).toBe('256');
    expect(q.get('BBOX')).toBe('0.00,-20037508.34,20037508.34,0.00');
    expect(wmsGetMapUrl('https://example.org/wms?map=a', 'x', 0, 0, 0)).toContain('?map=a&SERVICE=WMS');
  });

  it('fills XYZ templates', () => {
    expect(sourceTileUrl(byId('us-naip'), 10, 300, 400)).toMatch(/\/tile\/10\/400\/300$/);
    expect(sourceTileUrl(byId('es-pnoa'), 3, 1, 2)).toMatch(/\/3\/1\/5\.jpeg$/);
    expect(sourceTileUrl(byId('de-nrw'), 16, 34000, 21800)).toMatch(/EPSG_3857_16\/11\/34000\/21800$/);
    expect(sourceTileUrl(byId('de-nrw'), 9, 1, 2)).toMatch(/\/04\/1\/2$/);
    expect(sourceTileUrl(byId('lu'), 5, 1, 2)).toMatch(/^https:\/\/wmts4\.geoportail/);
    expect(sourceTileUrl(byId('maptiler'), 5, 1, 2, { maptiler: 'a b' })).toBe('https://api.maptiler.com/tiles/satellite-v2/5/1/2.jpg?key=a%20b');
    expect(sourceTileUrl(byId('de-bayern'), 16, 34800, 22500)).toContain('LAYERS=by_dop20c');
  });

  it('cuts 512 px and overzoomed tiles from their native tile', () => {
    expect(nativeTile(byId('maptiler'), 10, 5, 7)).toEqual({ z: 9, x: 2, y: 3, n: 2, col: 1, row: 1 });
    expect(nativeTile(byId('us-naip'), 12, 5, 7)).toEqual({ z: 12, x: 5, y: 7, n: 1, col: 0, row: 0 });
    expect(nativeTile(byId('us-naip'), 18, 13, 6)).toEqual({ z: 16, x: 3, y: 1, n: 4, col: 1, row: 2 });
  });
});

describe('source choice', () => {
  it('uses the national source first, then MapTiler, then Esri', () => {
    const rotterdam = lngLatTile(4.48, 51.92, 16);
    expect(ids(...rotterdam, KEYS)).toEqual(['nl-pdok', 'maptiler', 'esri']);
    const manhattan = lngLatTile(-73.98, 40.76, 15);
    expect(ids(...manhattan, KEYS)[0]).toBe('us-naip');
  });

  it('hides keyed sources without keys and Esri offline', () => {
    const london = lngLatTile(-0.12, 51.5, 15);
    expect(ids(...london)).toEqual([]);
    expect(ids(...london, KEYS)).toEqual(['maptiler', 'esri']);
    expect(ids(...london, KEYS, false)).toEqual(['maptiler']);
  });

  it('tries both countries across a border, the smaller box first', () => {
    const venloNl = lngLatTile(6.16, 51.37, 16);
    expect(ids(...venloNl).slice(0, 2).toSorted()).toEqual(['de-nrw', 'nl-pdok']);
    const deSide = lngLatTile(6.25, 51.37, 16);
    expect(ids(...deSide).slice(0, 2).toSorted()).toEqual(['de-nrw', 'nl-pdok']);
    expect(ids(...lngLatTile(7.0, 51.4, 16))[0]).toBe('de-nrw');
    expect(ids(...lngLatTile(5.5, 52.3, 16))[0]).toBe('nl-pdok');
  });

  it('prefers city sources inside their region', () => {
    expect(ids(...lngLatTile(13.4, 52.52, 16))[0]).toBe('de-berlin');
    expect(ids(...lngLatTile(13.4, 52.52, 16))).toContain('de-brandenburg');
    expect(ids(...lngLatTile(10.0, 53.55, 16))[0]).toBe('de-hamburg');
    expect(ids(...lngLatTile(4.35, 50.85, 16))[0]).toBe('be-brussels');
  });

  it('uses WMS states only from their minimum zoom', () => {
    expect(ids(...lngLatTile(11.5, 48.4, 10))).not.toContain('de-bayern');
    expect(ids(...lngLatTile(11.5, 48.4, 14))[0]).toBe('de-bayern');
  });

  it('stretches a national source past its top zoom only as a last resort', () => {
    const c = candidates(...lngLatTile(-73.98, 40.76, 18), { keys: KEYS, online: true });
    expect(c.map((x) => x.source.id)).toEqual(['maptiler', 'esri', 'us-naip']);
    expect(c.at(-1)?.overzoom).toBe(true);
    expect(ids(...lngLatTile(-73.98, 40.76, 20))).toEqual([]);
  });

  it('orders by tier', () => {
    const tiers = candidates(...lngLatTile(4.48, 51.92, 16), { keys: KEYS, online: true }).map((c) => c.source.tier);
    expect(tiers).toEqual([SatTier.National, SatTier.Global, SatTier.Fallback]);
  });
});

describe('detail and blank tests', () => {
  it('treats missing or tiny MapTiler tiles as lacking detail', () => {
    expect(lacksDetail(404, 0, 512, 10)).toBe(true);
    expect(lacksDetail(200, 0, 512, 10)).toBe(true);
    expect(lacksDetail(200, 4000, 512, 12)).toBe(false);
    expect(lacksDetail(200, 4000, 512, 16)).toBe(true);
    expect(lacksDetail(200, 60000, 512, 16)).toBe(false);
  });

  it('classifies white and transparent tiles as blank', () => {
    const white = new Uint8ClampedArray(px(255, 255, 255, 255, 100));
    const clear = new Uint8ClampedArray(px(10, 20, 30, 0, 100));
    const photo = new Uint8ClampedArray(px(80, 120, 60, 255, 100));
    const half = new Uint8ClampedArray([...px(255, 255, 255, 255, 50), ...px(80, 120, 60, 255, 50)]);
    expect(coverageOf(noDataShare(white))).toBe(Coverage.Empty);
    expect(coverageOf(noDataShare(clear))).toBe(Coverage.Empty);
    expect(coverageOf(noDataShare(photo))).toBe(Coverage.Full);
    expect(coverageOf(noDataShare(half))).toBe(Coverage.Partial);
    expect(maskNoData(half)).toBe(50);
    expect(half[3]).toBe(0);
    expect(half[50 * 4 + 3]).toBe(255);
  });
});

describe('credits', () => {
  it('credits GSI by zoom band', () => {
    const gsi = byId('jp-gsi');
    expect(creditFor(gsi, 6)).toContain('NASA');
    expect(creditFor(gsi, 11)).toContain('Landsat8');
    expect(creditFor(gsi, 16)).toContain('Axelspace');
    for (const z of [6, 11, 16]) expect(creditFor(gsi, z)).toContain('地理院タイル');
  });

  it('credits every source that may draw in the view', () => {
    const venlo = { west: 6.05, south: 51.3, east: 6.3, north: 51.45 };
    const c = creditsFor(venlo, 15, { keys: {}, online: true });
    expect(c).toContain('Beeldmateriaal Nederland / PDOK');
    expect(c.some((t) => t.includes('NRW'))).toBe(true);
    expect(c.some((t) => t.includes('MapTiler'))).toBe(false);
    const withKeys = creditsFor(venlo, 15, { keys: KEYS, online: false });
    expect(withKeys.some((t) => t.includes('MapTiler'))).toBe(true);
    expect(withKeys.some((t) => t.includes('Esri'))).toBe(false);
  });
});

describe('compositing', () => {
  it('fills only blank output pixels from data pixels', () => {
    const out = bytes(1, 2, 3, 255, 0, 0, 0, 0, 0, 0, 0, 0);
    const blank = fillBlank(out, bytes(9, 9, 9, 255, 40, 50, 60, 255, 255, 255, 255, 255));
    expect([...out]).toEqual([1, 2, 3, 255, 40, 50, 60, 255, 0, 0, 0, 0]);
    expect(blank).toBe(1);
  });
  it('whitens what no source covered', () => {
    const out = bytes(1, 2, 3, 255, 0, 0, 0, 0);
    whitenBlank(out);
    expect([...out]).toEqual([1, 2, 3, 255, 255, 255, 255, 255]);
  });
});

describe('offline packs', () => {
  it('use only Offline sources', () => {
    const offIds = (lng: number, lat: number) => offlineCandidates(...lngLatTile(lng, lat, 16)).map((s) => s.id);
    expect(offIds(4.48, 51.92)).toEqual([]);
    expect(offIds(6.16, 51.37)).toEqual(['de-nrw']);
    expect(offIds(11.5, 48.1)).toContain('de-bayern');
    expect(offIds(-73.98, 40.76)).toEqual([]);
  });
});
