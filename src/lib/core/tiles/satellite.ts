/** Satellite and aerial imagery sources and the per-tile choice between them. No alias imports: vite.config reads it for the SW cache. */

export const CachePolicy = {
  /** May go in offline packs. */
  Offline: 'offline',
  /** Browser and SW cache only; never prefetched. */
  DeviceCache: 'device',
  None: 'none'
} as const;
export type CachePolicy = (typeof CachePolicy)[keyof typeof CachePolicy];

export const SatKind = { Xyz: 'xyz', Wms: 'wms' } as const;
export type SatKind = (typeof SatKind)[keyof typeof SatKind];

export const SatTier = { National: 'national', Global: 'global', Fallback: 'fallback' } as const;
export type SatTier = (typeof SatTier)[keyof typeof SatTier];

export const SatKey = { MapTiler: 'maptiler', Esri: 'esri' } as const;
export type SatKey = (typeof SatKey)[keyof typeof SatKey];

export type SatKeys = Partial<Record<SatKey, string>>;

export interface SatBbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** A credit shown for zooms `minZoom`–`maxZoom` of the map. */
export interface ZoomCredit {
  minZoom: number;
  maxZoom: number;
  text: string;
}

export interface SatSource {
  id: string;
  name: string;
  tier: SatTier;
  kind: SatKind;
  /** XYZ template ({z} {x} {y} {-y} {s} {key}) or the WMS base URL. */
  url: string;
  /** WMS GetMap layer; version 1.3.0, EPSG:3857, transparent PNG. */
  layers?: string;
  subdomains?: readonly string[];
  bboxes: readonly SatBbox[];
  /** Zooms of the source's own tile grid. */
  minZoom: number;
  maxZoom: number;
  tilePx: 256 | 512;
  attribution: string | readonly ZoomCredit[];
  cache: CachePolicy;
  key?: SatKey;
  /** Paints a flat colour outside its data, so only a uniform tile is no-data. */
  opaque?: true;
}

const box = (west: number, south: number, east: number, north: number): SatBbox => ({ west, south, east, north });

const DL_BY = '<a href="https://www.govdata.de/dl-de/by-2-0">dl-de/by-2-0</a>';
// LGL-BW asks for the licence's full name and the year the data was fetched.
const DL_BY_LONG = '<a href="https://www.govdata.de/dl-de/by-2-0">Datenlizenz Deutschland – Namensnennung – Version 2.0</a>';
const GSI_LINK = '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>';

export const SAT_SOURCES: readonly SatSource[] = [
  {
    id: 'be-brussels',
    name: 'Brussels UrbIS',
    tier: SatTier.National,
    kind: SatKind.Wms,
    url: 'https://geoservices-grid.irisnet.be/geoserver/urbisgrid/ows',
    layers: 'Ortho2024EO',
    bboxes: [box(4.24, 50.76, 4.48, 50.92)],
    minZoom: 12,
    maxZoom: 20,
    tilePx: 256,
    attribution: '© urbis.brussels (CC0)',
    cache: CachePolicy.Offline
  },
  {
    id: 'de-berlin',
    name: 'Berlin TrueDOP',
    tier: SatTier.National,
    kind: SatKind.Wms,
    url: 'https://gdi.berlin.de/services/wms/truedop_2024',
    layers: 'truedop_2024',
    bboxes: [box(13.08, 52.33, 13.77, 52.68)],
    minZoom: 11,
    maxZoom: 20,
    tilePx: 256,
    attribution: '© Geoportal Berlin, TrueDOP 2024 (dl-de/zero-2-0)',
    cache: CachePolicy.Offline
  },
  {
    id: 'de-hamburg',
    name: 'Hamburg DOP',
    tier: SatTier.National,
    kind: SatKind.Wms,
    url: 'https://geodienste.hamburg.de/wms_dop_zeitreihe_belaubt',
    layers: 'dop_zeitreihe_belaubt',
    bboxes: [box(9.7, 53.39, 10.33, 53.74)],
    minZoom: 11,
    maxZoom: 20,
    tilePx: 256,
    attribution: `© Freie und Hansestadt Hamburg, LGV (${DL_BY})`,
    cache: CachePolicy.Offline
  },
  {
    id: 'lu',
    name: 'geoportail.lu',
    tier: SatTier.National,
    kind: SatKind.Xyz,
    url: 'https://wmts{s}.geoportail.lu/opendata/wmts/ortho_latest/GLOBAL_WEBMERCATOR_4_V3/{z}/{x}/{y}.jpeg',
    subdomains: ['1', '2', '3', '4'],
    bboxes: [box(5.7, 49.4, 6.55, 50.2)],
    minZoom: 5,
    maxZoom: 20,
    tilePx: 256,
    attribution: '© ACT Luxembourg (CC0)',
    cache: CachePolicy.Offline,
    opaque: true
  },
  {
    id: 'nl-pdok',
    name: 'PDOK Luchtfoto',
    tier: SatTier.National,
    kind: SatKind.Xyz,
    url: 'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg',
    bboxes: [box(3.2, 50.6, 7.3, 53.7)],
    minZoom: 5,
    maxZoom: 20,
    tilePx: 256,
    attribution: 'Beeldmateriaal Nederland / PDOK',
    cache: CachePolicy.DeviceCache,
    opaque: true
  },
  {
    id: 'de-nrw',
    name: 'NRW DOP',
    tier: SatTier.National,
    kind: SatKind.Wms,
    url: 'https://www.wms.nrw.de/geobasis/wms_nw_dop',
    layers: 'nw_dop_rgb',
    bboxes: [box(5.8, 50.3, 9.5, 52.6)],
    minZoom: 11,
    maxZoom: 20,
    tilePx: 256,
    attribution: '© GeoBasis-DE / NRW (dl-de/zero-2-0)',
    cache: CachePolicy.Offline
  },
  {
    id: 'de-bayern',
    name: 'Bayern DOP20',
    tier: SatTier.National,
    kind: SatKind.Wms,
    url: 'https://geoservices.bayern.de/od/wms/dop/v1/dop20',
    layers: 'by_dop20c',
    bboxes: [box(8.9, 47.2, 13.9, 50.6)],
    minZoom: 11,
    maxZoom: 20,
    tilePx: 256,
    attribution: '© Bayerische Vermessungsverwaltung – www.geodaten.bayern.de (CC BY 4.0)',
    cache: CachePolicy.Offline
  },
  {
    id: 'de-bw',
    name: 'Baden-Württemberg DOP20',
    tier: SatTier.National,
    kind: SatKind.Wms,
    url: 'https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_LGL-BW_ATKIS_DOP_20_C',
    layers: 'IMAGES_DOP_20_RGB',
    bboxes: [box(7.5, 47.5, 10.5, 49.8)],
    minZoom: 11,
    maxZoom: 20,
    tilePx: 256,
    attribution: `© LGL-BW (${new Date().getFullYear()}) ${DL_BY_LONG}, www.lgl-bw.de`,
    cache: CachePolicy.Offline
  },
  {
    id: 'de-hessen',
    name: 'Hessen DOP',
    tier: SatTier.National,
    kind: SatKind.Wms,
    url: 'https://gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows',
    layers: 'he_dop_rgb',
    bboxes: [box(7.7, 49.4, 10.3, 51.7)],
    minZoom: 11,
    maxZoom: 20,
    tilePx: 256,
    attribution: '© HVBG',
    cache: CachePolicy.Offline
  },
  {
    id: 'de-thueringen',
    name: 'Thüringen DOP',
    tier: SatTier.National,
    kind: SatKind.Wms,
    url: 'https://www.geoproxy.geoportal-th.de/geoproxy/services/DOP',
    layers: 'th_dop',
    bboxes: [box(9.8, 50.2, 12.7, 51.7)],
    minZoom: 11,
    maxZoom: 20,
    tilePx: 256,
    attribution: '© GDI-Th (CC BY 4.0)',
    cache: CachePolicy.Offline
  },
  {
    id: 'de-brandenburg',
    name: 'Brandenburg DOP20',
    tier: SatTier.National,
    kind: SatKind.Wms,
    url: 'https://isk.geobasis-bb.de/mapproxy/dop20c/service/wms',
    layers: 'bebb_dop20c',
    bboxes: [box(11.2, 51.3, 14.8, 53.6)],
    minZoom: 11,
    maxZoom: 20,
    tilePx: 256,
    attribution: `© GeoBasis-DE/LGB, ${DL_BY}; © Geoportal Berlin, ${DL_BY}`,
    cache: CachePolicy.Offline
  },
  {
    id: 'ch-swissimage',
    name: 'SWISSIMAGE',
    tier: SatTier.National,
    kind: SatKind.Xyz,
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
    bboxes: [box(5.9, 45.8, 10.5, 47.9)],
    minZoom: 5,
    maxZoom: 20,
    tilePx: 256,
    attribution: '© Data: swisstopo',
    cache: CachePolicy.DeviceCache,
    opaque: true
  },
  {
    id: 'at-basemap',
    name: 'basemap.at Orthofoto',
    tier: SatTier.National,
    kind: SatKind.Xyz,
    url: 'https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg',
    bboxes: [box(9.5, 46.4, 17.2, 49.0)],
    minZoom: 5,
    maxZoom: 20,
    tilePx: 256,
    attribution: 'basemap.at (CC BY 4.0)',
    cache: CachePolicy.Offline,
    opaque: true
  },
  {
    id: 'pl-gugik',
    name: 'Geoportal.gov.pl',
    tier: SatTier.National,
    kind: SatKind.Wms,
    url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution',
    layers: 'Raster',
    bboxes: [box(14.1, 49, 24.2, 54.9)],
    minZoom: 11,
    maxZoom: 19,
    tilePx: 256,
    attribution: '© GUGiK',
    cache: CachePolicy.Offline
  },
  {
    id: 'fr-ign',
    name: 'IGN Orthophotos',
    tier: SatTier.National,
    kind: SatKind.Xyz,
    url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=HR.ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
    bboxes: [box(-5.5, 41, 10, 51.1), box(-61.9, 15.8, -61, 16.6), box(-61.3, 14.3, -60.8, 14.9), box(-54.7, 2.1, -51.5, 5.8), box(55.2, -21.4, 55.9, -20.8), box(45, -13.1, 45.3, -12.6)],
    minZoom: 6,
    maxZoom: 19,
    tilePx: 256,
    attribution: '© IGN',
    cache: CachePolicy.Offline,
    opaque: true
  },
  {
    id: 'es-pnoa',
    name: 'PNOA',
    tier: SatTier.National,
    kind: SatKind.Xyz,
    url: 'https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{-y}.jpeg',
    bboxes: [box(-9.4, 35.9, 4.4, 43.8), box(-18.2, 27.6, -13.4, 29.5)],
    minZoom: 5,
    maxZoom: 19,
    tilePx: 256,
    attribution: 'PNOA cedido por © IGN',
    cache: CachePolicy.Offline
  },
  {
    id: 'us-naip',
    name: 'USGS Imagery',
    tier: SatTier.National,
    kind: SatKind.Xyz,
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    bboxes: [box(-125, 24, -66, 49.5), box(-170, 51, -129, 71.5), box(-160.5, 18.8, -154.7, 22.3), box(-67.5, 17.8, -65.2, 18.6)],
    minZoom: 5,
    maxZoom: 16,
    tilePx: 256,
    attribution: 'USGS The National Map',
    cache: CachePolicy.DeviceCache,
    opaque: true
  },
  {
    id: 'jp-gsi',
    name: 'GSI seamlessphoto',
    tier: SatTier.National,
    kind: SatKind.Xyz,
    url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
    bboxes: [box(122, 20, 154, 46)],
    minZoom: 5,
    maxZoom: 18,
    tilePx: 256,
    attribution: [
      { minZoom: 0, maxZoom: 8, text: `${GSI_LINK} (世界衛星モザイク画像: NASA LP DAAC, USGS EROS)` },
      { minZoom: 9, maxZoom: 13, text: `${GSI_LINK} (Landsat8: GSI, TSIC, GEO Grid/AIST; courtesy of the U.S. Geological Survey; 海底地形: GEBCO)` },
      { minZoom: 14, maxZoom: 99, text: `${GSI_LINK} (全国最新写真, 一部 © Axelspace)` }
    ],
    cache: CachePolicy.DeviceCache,
    opaque: true
  },
  {
    id: 'maptiler',
    name: 'MapTiler Satellite',
    tier: SatTier.Global,
    kind: SatKind.Xyz,
    url: 'https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key={key}',
    bboxes: [box(-180, -85.06, 180, 85.06)],
    minZoom: 0,
    maxZoom: 19,
    tilePx: 512,
    attribution: '<a href="https://www.maptiler.com/copyright/">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
    cache: CachePolicy.DeviceCache,
    key: SatKey.MapTiler,
    opaque: true
  },
  {
    id: 'esri',
    name: 'Esri World Imagery',
    tier: SatTier.Fallback,
    kind: SatKind.Xyz,
    url: 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token={key}',
    bboxes: [box(-180, -85.06, 180, 85.06)],
    minZoom: 0,
    maxZoom: 19,
    tilePx: 256,
    attribution: 'Powered by Esri. Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community',
    cache: CachePolicy.None,
    key: SatKey.Esri,
    opaque: true
  }
];

/** Top zoom of the map's satellite source; MapLibre overzooms past it. */
export const SAT_MAX_ZOOM = 20;
/** A national source is stretched at most this many zooms past its own when nothing else covers. */
export const MAX_OVERZOOM = 3;

// --- tile geometry ------------------------------------------------------

const R = 6378137;
const HALF = Math.PI * R;

/** EPSG:3857 metres [minX, minY, maxX, maxY] of an XYZ tile. */
export function tileBbox3857(z: number, x: number, y: number): [number, number, number, number] {
  const size = (2 * HALF) / 2 ** z;
  return [x * size - HALF, HALF - (y + 1) * size, (x + 1) * size - HALF, HALF - y * size];
}

const lngOf = (x: number, n: number) => (x / n) * 360 - 180;
const latOf = (y: number, n: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;

export function tileLngLatBbox(z: number, x: number, y: number): SatBbox {
  const n = 2 ** z;
  return { west: lngOf(x, n), south: latOf(y + 1, n), east: lngOf(x + 1, n), north: latOf(y, n) };
}

const intersects = (a: SatBbox, b: SatBbox) => a.west <= b.east && b.west <= a.east && a.south <= b.north && b.south <= a.north;
const contains = (b: SatBbox, lng: number, lat: number) => lng >= b.west && lng <= b.east && lat >= b.south && lat <= b.north;

// --- URLs ---------------------------------------------------------------

/** WMS 1.3.0 GetMap for one web-mercator tile; EPSG:3857 keeps x,y axis order. */
export function wmsGetMapUrl(base: string, layers: string, z: number, x: number, y: number, px = 256): string {
  const bbox = tileBbox3857(z, x, y)
    .map((v) => v.toFixed(2))
    .join(',');
  const q = `SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${encodeURIComponent(layers)}&STYLES=&CRS=EPSG:3857&BBOX=${bbox}&WIDTH=${px}&HEIGHT=${px}&FORMAT=image/png&TRANSPARENT=TRUE`;
  return `${base}${base.includes('?') ? '&' : '?'}${q}`;
}

/** URL of the source's own tile z/x/y. */
export function sourceTileUrl(s: SatSource, z: number, x: number, y: number, keys: SatKeys = {}): string {
  if (s.kind === SatKind.Wms) return wmsGetMapUrl(s.url, s.layers ?? '', z, x, y, s.tilePx);
  const sub = s.subdomains?.length ? s.subdomains[(x + y) % s.subdomains.length] : '';
  return s.url
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{-y}', String(2 ** z - 1 - y))
    .replace('{y}', String(y))
    .replace('{s}', sub)
    .replace('{key}', s.key ? encodeURIComponent(keys[s.key] ?? '') : '');
}

/** The source tile a 256 px map tile is cut from: cell (col, row) of an n×n grid over it. */
export interface NativeTile {
  z: number;
  x: number;
  y: number;
  n: number;
  col: number;
  row: number;
}

export function nativeTile(s: SatSource, z: number, x: number, y: number): NativeTile {
  const shift = s.tilePx === 512 ? 1 : 0;
  const nz = Math.max(0, Math.min(z - shift, s.maxZoom));
  const d = z - nz;
  return { z: nz, x: x >> d, y: y >> d, n: 2 ** d, col: x - ((x >> d) << d), row: y - ((y >> d) << d) };
}

// --- choice -------------------------------------------------------------

export interface Candidate {
  source: SatSource;
  /** Stretched past the source's top zoom: a last resort. */
  overzoom: boolean;
}

export interface ChoiceContext {
  keys: SatKeys;
  online: boolean;
}

/** A keyed source without its key is hidden. */
export const hasKey = (s: SatSource, keys: SatKeys) => !s.key || !!keys[s.key];

/** National sources whose box meets the tile and zoom range: transparent before opaque, then the smallest box holding the tile's centre. */
function nationals(z: number, x: number, y: number, keys: SatKeys): { exact: SatSource[]; stretched: SatSource[] } {
  const t = tileLngLatBbox(z, x, y);
  const cLng = (t.west + t.east) / 2;
  const cLat = (t.south + t.north) / 2;
  const inside: SatSource[] = [];
  const edge: SatSource[] = [];
  const stretched: SatSource[] = [];
  for (const s of SAT_SOURCES) {
    if (s.tier !== SatTier.National || !hasKey(s, keys) || z < s.minZoom || !s.bboxes.some((b) => intersects(b, t))) continue;
    if (z > s.maxZoom) {
      if (z <= s.maxZoom + MAX_OVERZOOM) stretched.push(s);
      continue;
    }
    (s.bboxes.some((b) => contains(b, cLng, cLat)) ? inside : edge).push(s);
  }
  const area = (s: SatSource) => Math.min(...s.bboxes.filter((b) => contains(b, cLng, cLat)).map((b) => (b.east - b.west) * (b.north - b.south)));
  inside.sort((a, b) => area(a) - area(b));
  // An opaque tile ends a composite, so it goes under every source that can leave gaps.
  const exact = [...inside, ...edge].toSorted((a, b) => Number(!!a.opaque) - Number(!!b.opaque));
  return { exact, stretched };
}

/** Sources to try for a map tile, best first: national, MapTiler, Esri (online only), stretched national. */
export function candidates(z: number, x: number, y: number, ctx: ChoiceContext): Candidate[] {
  const { exact, stretched } = nationals(z, x, y, ctx.keys);
  const out: Candidate[] = exact.map((source) => ({ source, overzoom: false }));
  for (const s of SAT_SOURCES) {
    if (s.tier === SatTier.National || !hasKey(s, ctx.keys) || z < s.minZoom) continue;
    if (s.cache === CachePolicy.None && !ctx.online) continue;
    out.push({ source: s, overzoom: false });
  }
  for (const source of stretched) out.push({ source, overzoom: true });
  return out;
}

/** Bytes per pixel under which a MapTiler tile is taken as upsampled, low-detail imagery. */
export const LOW_DETAIL_BYTES_PER_PX = 0.04;
/** Zoom from which MapTiler detail is checked; its global imagery is fine below. */
export const DETAIL_CHECK_ZOOM = 14;

/** MapTiler lacks detail at this zoom: no tile, or a JPEG too small to hold sharp imagery. */
export function lacksDetail(status: number, bytes: number, px: number, z: number): boolean {
  if (status < 200 || status >= 300 || status === 204 || bytes === 0) return true;
  return z >= DETAIL_CHECK_ZOOM && bytes / (px * px) < LOW_DETAIL_BYTES_PER_PX;
}

// --- blank detection ----------------------------------------------------

export const Coverage = { Empty: 'empty', Partial: 'partial', Full: 'full' } as const;
export type Coverage = (typeof Coverage)[keyof typeof Coverage];

/** Only alpha marks no-data: white or black pixels may be snow, roofs or shadow. */
export const isNoData = (a: number) => a < 8;

const FULL_AT = 0.005;
/** Per-channel spread a flat JPEG fill keeps. */
const FILL_SPREAD = 3;

/** Share of no-data pixels in RGBA bytes, sampling every `step`th pixel. */
export function noDataShare(rgba: Uint8ClampedArray, step = 1): number {
  let none = 0;
  let seen = 0;
  for (let i = 0; i < rgba.length; i += 4 * step) {
    seen++;
    if (isNoData(rgba[i + 3])) none++;
  }
  return seen ? none / seen : 1;
}

export function coverageOf(share: number): Coverage {
  return share >= 1 ? Coverage.Empty : share <= FULL_AT ? Coverage.Full : Coverage.Partial;
}

/** Every pixel one near-white or near-black colour: an opaque source's fill outside its data. */
export function uniformFill(rgba: Uint8ClampedArray): boolean {
  if (!rgba.length) return false;
  const [r, g, b] = rgba;
  const lo = Math.min(r, g, b);
  const hi = Math.max(r, g, b);
  if (lo < 250 - FILL_SPREAD && hi > 5 + FILL_SPREAD) return false;
  for (let i = 0; i < rgba.length; i += 4) {
    if (Math.abs(rgba[i] - r) > FILL_SPREAD || Math.abs(rgba[i + 1] - g) > FILL_SPREAD || Math.abs(rgba[i + 2] - b) > FILL_SPREAD) return false;
  }
  return true;
}

/** How much of a source tile holds data: by alpha, or for an opaque source whole-tile fill only. */
export function tileCoverage(rgba: Uint8ClampedArray, s: Pick<SatSource, 'opaque'>): Coverage {
  if (s.opaque && uniformFill(rgba)) return Coverage.Empty;
  return coverageOf(noDataShare(rgba, 4));
}

// --- credits and cache policy ------------------------------------------

export function creditFor(s: SatSource, z: number): string {
  if (typeof s.attribution === 'string') return s.attribution;
  return s.attribution.find((c) => z >= c.minZoom && z <= c.maxZoom)?.text ?? s.attribution[0].text;
}

/** Credits of every source that may draw in the view at this zoom. */
export function creditsFor(view: SatBbox, z: number, ctx: ChoiceContext): string[] {
  const zi = Math.round(z);
  const out: string[] = [];
  for (const s of SAT_SOURCES) {
    if (!hasKey(s, ctx.keys) || (s.cache === CachePolicy.None && !ctx.online)) continue;
    if (zi < s.minZoom || zi > s.maxZoom + (s.tier === SatTier.National ? MAX_OVERZOOM : 99)) continue;
    if (!s.bboxes.some((b) => intersects(b, view))) continue;
    out.push(creditFor(s, zi));
  }
  return out;
}

export const offlineSources = (): SatSource[] => SAT_SOURCES.filter((s) => s.cache === CachePolicy.Offline);

const SUB = 'subdomain0';
const hostOf = (url: string) => new URL(url.replace('{s}', SUB)).hostname;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Hosts the service worker may cache: every source except `None`. */
export function swCacheHosts(): string[] {
  const hosts = new Set<string>();
  for (const s of SAT_SOURCES) {
    if (s.cache === CachePolicy.None) continue;
    hosts.add(hostOf(s.url).replace(SUB, '{s}'));
  }
  return [...hosts];
}

/** `^https://(host|…)/` for the SW runtime cache. */
export function swCachePattern(): string {
  const alts = swCacheHosts().map((h) => escapeRe(h).replace('\\{s\\}', '[^.]+'));
  return `^https:\\/\\/(${alts.join('|')})\\/`;
}

// --- compositing --------------------------------------------------------

/** A composite stops once this share of pixels is still blank. */
export const DONE_AT = 0.005;

/** Fills the still-transparent pixels of `out` from `rgba`'s data pixels; returns how many stay blank. */
export function fillBlank(out: Uint8ClampedArray, rgba: Uint8ClampedArray): number {
  let blank = 0;
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3]) continue;
    if (isNoData(rgba[i + 3])) {
      blank++;
      continue;
    }
    out[i] = rgba[i];
    out[i + 1] = rgba[i + 1];
    out[i + 2] = rgba[i + 2];
    out[i + 3] = 255;
  }
  return blank;
}

/** Offline pack sources for a tile, best first. */
export const offlineCandidates = (z: number, x: number, y: number): SatSource[] =>
  candidates(z, x, y, { keys: {}, online: true })
    .filter((c) => !c.overzoom && c.source.cache === CachePolicy.Offline)
    .map((c) => c.source);

/** JPEG bytes assumed per offline tile for estimates. */
export const SAT_TILE_BYTES = 20_000;
export const SAT_OFFLINE_MIN_ZOOM = 11;
export const SAT_OFFLINE_ZOOMS = [14, 15, 16, 17, 18] as const;
export const SAT_OFFLINE_SOURCE = 'scape-sat:offline';
export const SAT_OFFLINE_ATTRIBUTION = 'Aerial imagery: national mapping agencies (see the map credits)';
