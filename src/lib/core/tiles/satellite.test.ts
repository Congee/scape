import { describe, expect, it } from 'vitest';
import {
  CachePolicy,
  Coverage,
  SAT_SOURCES,
  SatKind,
  type SatSource,
  SatTier,
  candidates,
  clearFill,
  coverageOf,
  creditFor,
  creditsFor,
  detailOf,
  fillBlank,
  fillMask,
  isNoData,
  lacksDetail,
  MASK_ZOOM,
  MaskLevel,
  maskTile,
  nativeTile,
  needsFillMask,
  noDataShare,
  offlineCandidates,
  offlineSources,
  sourceTileUrl,
  swCacheHosts,
  swCachePattern,
  tileBbox3857,
  tileCoverage,
  tileLngLatBbox,
  uniformFill,
  whiteRun,
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
    expect(q.get('FORMAT')).toBe('image/png');
    expect(q.get('TRANSPARENT')).toBe('TRUE');
    expect(q.get('BBOX')).toBe('0.00,-20037508.34,20037508.34,0.00');
    expect(wmsGetMapUrl('https://example.org/wms?map=a', 'x', 0, 0, 0)).toContain('?map=a&SERVICE=WMS');
  });

  it('fills XYZ templates', () => {
    expect(sourceTileUrl(byId('us-naip'), 10, 300, 400)).toMatch(/\/tile\/10\/400\/300$/);
    expect(sourceTileUrl(byId('es-pnoa'), 3, 1, 2)).toMatch(/\/3\/1\/5\.jpeg$/);
    expect(sourceTileUrl(byId('de-nrw'), 16, 34000, 21800)).toContain('LAYERS=nw_dop_rgb');
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

  it('asks transparent sources before opaque ones, which would hide what lies under their fill', () => {
    expect(ids(...lngLatTile(6.16, 51.37, 16)).slice(0, 2)).toEqual(['de-nrw', 'nl-pdok']);
    expect(ids(...lngLatTile(6.05, 51.9, 16)).slice(0, 2)).toEqual(['de-nrw', 'nl-pdok']);
    for (const s of SAT_SOURCES) expect(!!s.opaque).toBe(s.kind === SatKind.Xyz && s.id !== 'es-pnoa');
  });

  it('takes SWISSIMAGE abroad only after the neighbour, and first inside Switzerland', () => {
    const feldkirch = ids(...lngLatTile(9.598, 47.237, 17));
    expect(feldkirch.indexOf('at-basemap')).toBeGreaterThanOrEqual(0);
    expect(feldkirch.indexOf('at-basemap')).toBeLessThan(feldkirch.indexOf('ch-swissimage'));
    for (const [lng, lat] of [[7.44, 46.95], [8.54, 47.37], [9.53, 46.85], [9.83, 46.5], [7.985, 46.547]]) {
      expect(ids(...lngLatTile(lng, lat, 16))[0]).toBe('ch-swissimage');
    }
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

  it('marks no-data by alpha only, never by colour', () => {
    expect(isNoData(0)).toBe(true);
    expect(isNoData(255)).toBe(false);
    const white = new Uint8ClampedArray(px(255, 255, 255, 255, 100));
    const clear = new Uint8ClampedArray(px(10, 20, 30, 0, 100));
    const half = new Uint8ClampedArray([...px(0, 0, 0, 0, 50), ...px(255, 255, 255, 255, 50)]);
    const sliver = new Uint8ClampedArray([...px(0, 0, 0, 0, 99), ...px(80, 120, 60, 255, 1)]);
    expect(coverageOf(noDataShare(white))).toBe(Coverage.Full);
    expect(coverageOf(noDataShare(clear))).toBe(Coverage.Empty);
    expect(coverageOf(noDataShare(half))).toBe(Coverage.Partial);
    expect(coverageOf(noDataShare(sliver))).toBe(Coverage.Partial);
  });

  it('drops an opaque source only for a whole uniform white or black tile', () => {
    const snow = new Uint8ClampedArray(Array.from({ length: 400 }, (_, i) => [248 + (i % 8), 250 + (i % 6), 255, 255]).flat());
    const roofs = new Uint8ClampedArray([...px(255, 255, 255, 255, 90), ...px(90, 90, 95, 255, 10)]);
    const fillWhite = new Uint8ClampedArray([...px(255, 255, 255, 255, 99), ...px(254, 253, 255, 255, 1)]);
    const fillBlack = new Uint8ClampedArray(px(0, 1, 0, 255, 100));
    const grey = new Uint8ClampedArray(px(128, 128, 128, 255, 100));
    expect(uniformFill(snow)).toBe(false);
    expect(uniformFill(roofs)).toBe(false);
    expect(uniformFill(fillWhite)).toBe(true);
    expect(uniformFill(fillBlack)).toBe(true);
    expect(uniformFill(grey)).toBe(false);
    const opaque = { opaque: true } as const;
    expect(tileCoverage(snow, opaque)).toBe(Coverage.Full);
    expect(tileCoverage(roofs, opaque)).toBe(Coverage.Full);
    expect(tileCoverage(fillWhite, opaque)).toBe(Coverage.Empty);
    expect(tileCoverage(fillWhite, {})).toBe(Coverage.Full);
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

  it('credits German states as their licences ask', () => {
    expect(creditFor(byId('de-bw'), 16)).toMatch(new RegExp(`^© LGL-BW \\(${new Date().getFullYear()}\\) .*Datenlizenz Deutschland – Namensnennung – Version 2\\.0.*, www\\.lgl-bw\\.de$`));
    for (const id of ['de-hamburg', 'de-brandenburg']) expect(creditFor(byId(id), 16)).toContain('dl-de/by-2-0');
    expect(creditFor(byId('de-brandenburg'), 16)).toContain('© Geoportal Berlin');
    for (const id of ['de-bayern', 'de-thueringen']) expect(creditFor(byId(id), 16)).toContain('CC BY 4.0');
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
    const blank = fillBlank(out, bytes(9, 9, 9, 255, 255, 255, 255, 255, 40, 50, 60, 0));
    expect([...out]).toEqual([1, 2, 3, 255, 255, 255, 255, 255, 0, 0, 0, 0]);
    expect(blank).toBe(1);
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

const field = (x: number, y: number): [number, number, number] => [60 + ((x * 7 + y * 13) % 50), 90 + ((x * 3) % 40), 50];

describe('opaque fill mask', () => {
  const SIDE = 256;
  /** A 256 px tile coloured by `f(x, y)`. */
  const tile = (f: (x: number, y: number) => [number, number, number]) => {
    const out = new Uint8ClampedArray(SIDE * SIDE * 4);
    for (let y = 0; y < SIDE; y++) {
      for (let x = 0; x < SIDE; x++) {
        const [r, g, b] = f(x, y);
        out.set([r, g, b, 255], (y * SIDE + x) * 4);
      }
    }
    return out;
  };
  const alpha = (rgba: Uint8ClampedArray, x: number, y: number) => rgba[(y * SIDE + x) * 4 + 3];
  const nl = byId('nl-pdok');

  it('masks broad white at the coarse zoom, not snow noise', () => {
    const coarse = fillMask(tile((x, y) => (x < 64 ? [255, 255, 255] : field(x, y))));
    expect(coarse[10 * SIDE + 0]).toBe(MaskLevel.Fill);
    expect(coarse[10 * SIDE + 65]).toBe(MaskLevel.Fill);
    expect(coarse[10 * SIDE + 67]).toBe(MaskLevel.Near);
    expect(coarse[10 * SIDE + 70]).toBe(0);
    const snow = fillMask(tile((x, y) => [247 + ((x * 5 + y * 3) % 9), 252, 255]));
    expect(snow.some(Boolean)).toBe(false);
  });

  it('clears the fill of a finer tile but keeps white roofs and snow outside it', () => {
    // The z11 tile is white west of x = 64: all of cell (0, 0) of a 4×4 grid, whose east edge runs at x = 256.
    const mask = fillMask(tile((x, y) => (x < 64 ? [255, 255, 255] : field(x, y))));
    const inFill = tile(() => [255, 255, 255]);
    expect(clearFill(inFill, mask, { n: 4, col: 0, row: 0 })).toBe(SIDE * SIDE);
    const beside = tile((x, y) => (x > 100 && x < 160 && y > 100 && y < 160 ? [255, 255, 255] : field(x, y)));
    expect(clearFill(beside, mask, { n: 4, col: 1, row: 0 })).toBe(0);
    expect(alpha(beside, 130, 130)).toBe(255);
  });

  it('clears only the masked part of a border tile, with the JPEG ringing beside it', () => {
    const mask = fillMask(tile((x, y) => (x < 128 ? [255, 255, 255] : field(x, y))));
    const rgba = tile((x, y) => (x < 120 ? [255, 255, 255] : x === 120 ? [240, 242, 238] : x === 200 ? [240, 242, 238] : field(x, y)));
    const cleared = clearFill(rgba, mask, { n: 1, col: 0, row: 0 });
    expect(cleared).toBe(121 * SIDE);
    expect(alpha(rgba, 119, 5)).toBe(0);
    expect(alpha(rgba, 120, 5)).toBe(0);
    expect(alpha(rgba, 125, 5)).toBe(255);
    expect(alpha(rgba, 200, 5)).toBe(255);
    expect(whiteRun(rgba)).toBe(0);
  });

  it('stops following the fill into snow flush against it after a band', () => {
    const mask = fillMask(tile((x, y) => (x < 16 ? [255, 255, 255] : field(x, y))));
    const rgba = tile((x, y) => (x < 250 ? [255, 255, 255] : field(x, y)));
    clearFill(rgba, mask, { n: 1, col: 0, row: 0 });
    expect(alpha(rgba, 10, 5)).toBe(0);
    expect(alpha(rgba, 120, 5)).toBe(255);
  });

  it('follows the fill past the coarse mask through broad flat white only', () => {
    const mask = fillMask(tile((x, y) => (x < 128 ? [255, 255, 255] : field(x, y))));
    // Fill runs to x = 140 on the finer tile, and a white roof lies beyond it.
    const rgba = tile((x, y) => (x < 140 || (x > 200 && x < 230 && y > 100 && y < 130) ? [255, 255, 255] : field(x, y)));
    clearFill(rgba, mask, { n: 1, col: 0, row: 0 });
    expect(alpha(rgba, 139, 50)).toBe(0);
    expect(alpha(rgba, 215, 115)).toBe(255);
    const dot = tile((x, y) => (x < 128 || (x === 131 && y === 200) ? [255, 255, 255] : field(x, y)));
    clearFill(dot, mask, { n: 1, col: 0, row: 0 });
    expect(alpha(dot, 131, 200)).toBe(255);
  });

  it('looks a mask up only for white-heavy, patchy opaque national tiles', () => {
    const strip = tile((x, y) => (x < 20 ? [255, 255, 255] : field(x, y)));
    expect(needsFillMask(nl, strip)).toBe(true);
    expect(needsFillMask(byId('de-nrw'), strip)).toBe(false);
    expect(needsFillMask(byId('esri'), strip)).toBe(false);
    expect(needsFillMask(nl, tile(field))).toBe(false);
    expect(needsFillMask(nl, tile(() => [255, 255, 255]))).toBe(false);
  });

  it('takes the mask from the coarse tile above, or the tile itself at low zoom', () => {
    const [z, x, y] = lngLatTile(9.598, 47.237, 17);
    const m = maskTile(byId('at-basemap'), z, x, y);
    expect(m).toMatchObject({ z: MASK_ZOOM, x: x >> 6, y: y >> 6, n: 64, col: x % 64, row: y % 64 });
    expect(maskTile(nl, 9, 3, 4)).toEqual({ z: 9, x: 3, y: 4, n: 1, col: 0, row: 0 });
  });

  it('measures white strips and sharpness', () => {
    expect(whiteRun(tile((x, y) => (y >= 40 && y < 43 ? [255, 255, 255] : field(x, y))))).toBe(3);
    expect(whiteRun(tile((x, y) => (x < 50 && y < 50 ? [255, 255, 255] : field(x, y))))).toBe(50);
    expect(whiteRun(tile((x, y) => (x === 9 || y === 9 ? [255, 255, 255] : field(x, y))))).toBe(1);
    const sharp = tile((x, y) => (((x + y) & 1) === 1 ? [200, 200, 200] : [60, 60, 60]));
    const blocky = tile((x, y) => ((((x >> 3) + (y >> 3)) & 1) === 1 ? [200, 200, 200] : [60, 60, 60]));
    expect(detailOf(sharp)).toBeGreaterThan(100);
    expect(detailOf(blocky)).toBeLessThan(detailOf(sharp) / 4);
    expect(detailOf(tile(() => [90, 90, 90]))).toBe(0);
  });
});
