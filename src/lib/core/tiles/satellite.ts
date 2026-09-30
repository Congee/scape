/** Satellite and aerial imagery sources and the per-tile choice between them. No alias imports: vite.config reads it for the SW cache. */

export const CachePolicy = {
  /** May go in offline packs. */
  Offline: 'offline',
  /** Browser and SW cache only; never prefetched. */
  DeviceCache: 'device',
  None: 'none'
} as const;
export type CachePolicy = (typeof CachePolicy)[keyof typeof CachePolicy];

/** Export: an ArcGIS ImageServer `exportImage` base URL. */
export const SatKind = { Xyz: 'xyz', Wms: 'wms', Export: 'export' } as const;
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
  /** XYZ template ({z} {x} {y} {-y} {s} {key}), or the WMS or ImageServer base URL. */
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
  /** JPEG with a white fill outside its data, cleared by the fill mask. */
  opaque?: true;
  /** Blurry beyond its own country, so every other national source covering the tile goes first. */
  coarseAbroad?: true;
}

const box = (west: number, south: number, east: number, north: number): SatBbox => ({ west, south, east, north });

const DL_BY = '<a href="https://www.govdata.de/dl-de/by-2-0">dl-de/by-2-0</a>';
// LGL-BW asks for the licence's full name and the year the data was fetched.
const DL_BY_LONG = '<a href="https://www.govdata.de/dl-de/by-2-0">Datenlizenz Deutschland – Namensnennung – Version 2.0</a>';
const GSI_LINK = '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>';

type UsOrtho = Pick<SatSource, 'id' | 'name' | 'url' | 'attribution'> & Partial<SatSource> & { bbox: SatBbox };
/** A US state or city ortho: transparent (404 or alpha) outside its data. */
const us = ({ bbox, ...s }: UsOrtho): SatSource => ({ tier: SatTier.National, kind: SatKind.Xyz, bboxes: [bbox], minZoom: 14, maxZoom: 20, tilePx: 256, cache: CachePolicy.Offline, ...s });
const US_BOXES = [box(-125, 24, -66, 49.5), box(-170, 51, -129, 71.5), box(-160.5, 18.8, -154.7, 22.3), box(-67.5, 17.8, -65.2, 18.6)];
const ARCGIS_TILE = '/tile/{z}/{y}/{x}';
const KY_WM = 'https://kygisserver.ky.gov/arcgis/rest/services/WGS84WM_Services/';
const KY_CREDIT = 'KyFromAbove, Commonwealth of Kentucky, Division of Geographic Information';

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
    opaque: true,
    coarseAbroad: true
  },
  {
    id: 'at-basemap',
    name: 'basemap.at Orthofoto',
    tier: SatTier.National,
    kind: SatKind.Xyz,
    url: 'https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg',
    // Steps round Graubünden, where SWISSIMAGE would otherwise wait on basemap.at's fill.
    bboxes: [box(9.5, 47.05, 17.2, 49.0), box(9.85, 46.8, 17.2, 47.05), box(10.35, 46.35, 17.2, 46.8)],
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
    // Mainland boxes step round Switzerland, where SWISSIMAGE would otherwise wait on IGN's fill.
    bboxes: [
      box(-5.5, 42.3, 5.96, 51.1),
      box(5.9, 42.9, 7.8, 46),
      box(5.9, 46, 6.85, 46.42),
      box(5.9, 46.4, 6.25, 46.7),
      box(5.9, 46.7, 6.5, 46.95),
      box(5.9, 46.95, 6.95, 47.4),
      box(5.9, 47.35, 7.65, 49.6),
      box(7.5, 48.2, 8.3, 49.1),
      box(8.5, 41.3, 9.6, 43.1),
      box(-61.9, 15.8, -61, 16.6), box(-61.3, 14.3, -60.8, 14.9), box(-54.7, 2.1, -51.5, 5.8), box(55.2, -21.4, 55.9, -20.8), box(45, -13.1, 45.3, -12.6)],
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
  us({
    id: 'us-dc',
    name: 'DC Orthophoto 2025',
    url: `https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Ortho2025_WebMercator/MapServer${ARCGIS_TILE}`,
    bbox: box(-77.12, 38.79, -76.91, 39.0),
    attribution: 'DC Office of the Chief Technology Officer (CC BY 4.0)'
  }),
  us({
    id: 'us-nyc',
    name: 'NYC Orthoimagery 2024',
    url: `https://tiles.arcgis.com/tiles/yG5s3afENB5iO9fj/arcgis/rest/services/NYC_Orthos_2024/MapServer${ARCGIS_TILE}`,
    bbox: box(-74.26, 40.49, -73.7, 40.92),
    attribution: 'NYC OTI (CC BY 4.0)'
  }),
  us({
    id: 'us-fulton',
    name: 'Fulton County Imagery 2019',
    kind: SatKind.Export,
    url: 'https://alphagis.alpharetta.ga.us/imagery/rest/services/am2019_WM/ImageServer',
    bbox: box(-84.86, 33.5, -84.09, 34.19),
    attribution: 'Fulton County GIS / ARC (CC BY 4.0)'
  }),
  us({
    id: 'us-ct',
    name: 'CT Orthoimagery 2023',
    url: `https://cteco.uconn.edu/ctraster/rest/services/images/Ortho_2023_tiled/ImageServer${ARCGIS_TILE}`,
    bbox: box(-73.73, 40.95, -71.78, 42.06),
    attribution: 'CT ECO / UConn (CC0)'
  }),
  us({
    id: 'us-ma',
    name: 'MassGIS Imagery 2025',
    url: `https://tiles.arcgis.com/tiles/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Aerial_Imagery_2025/MapServer${ARCGIS_TILE}`,
    bbox: box(-73.51, 41.23, -69.92, 42.89),
    attribution: 'MassGIS'
  }),
  us({
    id: 'us-nh',
    name: 'NH GRANIT 2021–22',
    kind: SatKind.Wms,
    url: 'https://nhgeodata.unh.edu/image/services/ImageServices/NH_2021_2022_6in_RGB/ImageServer/WMSServer',
    layers: 'NH_2021_2022_6in_RGB',
    bbox: box(-72.56, 42.69, -70.61, 45.31),
    attribution: 'NH GRANIT'
  }),
  us({
    id: 'us-vt',
    name: 'VCGI Imagery',
    url: `https://maps.vcgi.vermont.gov/arcgis/rest/services/EGC_services/IMG_VCGI_CLR_WM_CACHE/ImageServer${ARCGIS_TILE}`,
    bbox: box(-73.44, 42.73, -71.46, 45.02),
    maxZoom: 19,
    attribution: 'VCGI'
  }),
  us({
    id: 'us-nj',
    name: 'NJ Orthophoto 2020',
    url: `https://maps.nj.gov/arcgis/rest/services/Basemap/Orthos_Natural_2020_NJ_WM/MapServer${ARCGIS_TILE}`,
    bbox: box(-75.56, 38.93, -73.89, 41.36),
    attribution: 'NJ Office of Information Technology, Office of GIS (NJOGIS), 2020'
  }),
  us({
    id: 'us-de',
    name: 'FirstMap Delaware 2022',
    url: `https://imagery.firstmap.delaware.gov/imagery/rest/services/DE_Imagery/DE_Imagery_2022/ImageServer${ARCGIS_TILE}`,
    bbox: box(-75.79, 38.45, -75.05, 39.84),
    attribution: 'State of Delaware, Sanborn Map Company, Inc.',
    cache: CachePolicy.DeviceCache
  }),
  us({
    id: 'us-sc',
    name: 'SC Imagery 2023',
    url: `https://tiles.arcgis.com/tiles/RvqSyw3diI7dTKo5/arcgis/rest/services/SC_2023_RGB/MapServer${ARCGIS_TILE}`,
    bbox: box(-83.36, 32.03, -78.54, 35.22),
    attribution: 'SC Revenue and Fiscal Affairs Office; Kucera International (2023)',
    cache: CachePolicy.DeviceCache
  }),
  us({
    id: 'us-oh',
    name: 'OSIP Ohio',
    url: `https://maps.ohio.gov/image/rest/services/osip_most_current_cache/MapServer${ARCGIS_TILE}`,
    bbox: box(-84.82, 38.4, -80.52, 41.98),
    attribution: 'OGRIP / OSIP, State of Ohio'
  }),
  us({
    id: 'us-in',
    name: 'Indiana Current Imagery',
    kind: SatKind.Export,
    url: 'https://di-ingov.img.arcgis.com/arcgis/rest/services/DynamicWebMercator/Indiana_Current_Imagery/ImageServer',
    bbox: box(-88.1, 37.77, -84.78, 41.77),
    attribution: 'Indiana GIO (CC0)'
  }),
  // Same box: the 3-inch phase goes first and falls through to the 6-inch one where it has none.
  us({
    id: 'us-ky3',
    name: 'KyFromAbove Phase 3',
    url: `${KY_WM}Ky_Imagery_Phase3_3IN_WGS84WM/MapServer${ARCGIS_TILE}`,
    bbox: box(-89.58, 36.49, -81.96, 39.15),
    attribution: KY_CREDIT
  }),
  us({
    id: 'us-ky',
    name: 'KyFromAbove Phase 2',
    url: `${KY_WM}Ky_Imagery_Phase2_6IN_WGS84WM/MapServer${ARCGIS_TILE}`,
    bbox: box(-89.58, 36.49, -81.96, 39.15),
    attribution: KY_CREDIT
  }),
  us({
    id: 'us-va',
    name: 'VBMP Most Recent',
    url: `https://vginmaps.vdem.virginia.gov/arcgis/rest/services/VBMP_Imagery/MostRecentImagery_WGS/MapServer${ARCGIS_TILE}`,
    bbox: box(-83.68, 36.54, -75.24, 39.47),
    maxZoom: 19,
    attribution: 'Virginia Geographic Information Network (VGIN), VBMP; for general information only, not for design or flood plain determination'
  }),
  us({
    id: 'us-mo',
    name: 'MSDIS Missouri 2023–24',
    kind: SatKind.Export,
    url: 'https://stateimagery.msdis.missouri.edu/arcgis/rest/services/Missouri_6inch_Statewide_2023_2024_Dynamic/ImageServer',
    bbox: box(-95.77, 35.99, -89.1, 40.61),
    attribution: 'MSDIS, University of Missouri; Sanborn (2023–24)',
    cache: CachePolicy.DeviceCache
  }),
  us({
    id: 'us-nc',
    name: 'NC OneMap Orthoimagery',
    url: `https://services.nconemap.gov/secure/rest/services/Imagery/Orthoimagery_Latest_cached/ImageServer${ARCGIS_TILE}`,
    bbox: box(-84.33, 33.84, -75.45, 36.59),
    attribution: 'NC OneMap / NC CGIA'
  }),
  {
    id: 'us-naipplus',
    name: 'USGS NAIP Plus',
    tier: SatTier.National,
    kind: SatKind.Wms,
    url: 'https://imagery.nationalmap.gov/arcgis/services/USGSNAIPPlus/ImageServer/WMSServer',
    layers: 'USGSNAIPPlus',
    bboxes: US_BOXES,
    minZoom: 17,
    maxZoom: 18,
    tilePx: 256,
    attribution: 'USGS, USDA, The National Map',
    cache: CachePolicy.Offline
  },
  {
    id: 'us-naip',
    name: 'USGS Imagery',
    tier: SatTier.National,
    kind: SatKind.Xyz,
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    bboxes: US_BOXES,
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

/** ArcGIS ImageServer exportImage for one web-mercator tile. */
export function exportImageUrl(base: string, z: number, x: number, y: number, px = 256): string {
  const bbox = tileBbox3857(z, x, y)
    .map((v) => v.toFixed(2))
    .join(',');
  return `${base}/exportImage?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=${px},${px}&format=png32&f=image`;
}

/** URL of the source's own tile z/x/y. */
export function sourceTileUrl(s: SatSource, z: number, x: number, y: number, keys: SatKeys = {}): string {
  if (s.kind === SatKind.Wms) return wmsGetMapUrl(s.url, s.layers ?? '', z, x, y, s.tilePx);
  if (s.kind === SatKind.Export) return exportImageUrl(s.url, z, x, y, s.tilePx);
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

export const ImageMime = { Png: 'image/png', Jpeg: 'image/jpeg', Webp: 'image/webp' } as const;
export type ImageMime = (typeof ImageMime)[keyof typeof ImageMime];

const startsWith = (head: Uint8Array, magic: readonly number[], at = 0) => magic.every((b, i) => head[at + i] === b);

/** An image's type by its magic bytes, or null: servers send JPEG as octet-stream and errors as 200 JSON. */
export function sniffImage(head: Uint8Array): ImageMime | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return ImageMime.Png;
  if (startsWith(head, [0xff, 0xd8, 0xff])) return ImageMime.Jpeg;
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) return ImageMime.Webp;
  return null;
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

// Transparent sources leave gaps cleanly; a coarse-abroad source only fills what the others lack.
const rank = (s: SatSource) => (s.coarseAbroad ? 2 : s.opaque ? 1 : 0);

/** National sources whose box meets the tile and zoom range: transparent, opaque, then coarse-abroad; within each, the smallest box holding the tile's centre. */
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
  const exact = [...inside, ...edge].toSorted((a, b) => rank(a) - rank(b));
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

// --- opaque fill mask ---------------------------------------------------

/** Zoom of the coarse tile whose broad white areas tell an opaque source's fill from snow or roofs. */
export const MASK_ZOOM = 11;
/** Near-white pixels a tile needs before its mask is looked up. */
export const WHITE_CHECK_PX = 64;
const MASK_PX = 256;
const WHITE_MIN = 250;
/** JPEG ringing at the fill's edge, peeled off in a few passes. */
const FRINGE_MIN = 200;
const FRINGE_PASSES = 3;
/** Pixels the fill is followed past its seeds, so snow beside it keeps all but a band. */
const FLOOD_MAX = 64;
/** Mask pixels the eroded fill grows back by, past the ringing at its edge. */
const MASK_GROW = 3;
/** Mask pixels further out where only broad flat white is taken as fill: the coarse tile's edge lags the fine one's. */
const MASK_NEAR = 7;
/** Mask values: white is fill; broad flat white is fill. */
export const MaskLevel = { Fill: 2, Near: 1 } as const;

const isWhite = (rgba: Uint8ClampedArray, i: number, min = WHITE_MIN) => rgba[i] >= min && rgba[i + 1] >= min && rgba[i + 2] >= min;

export function whiteCount(rgba: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) if (isWhite(rgba, i)) n++;
  return n;
}

/** An opaque national tile with enough white to be worth masking. */
export const needsFillMask = (s: Pick<SatSource, 'opaque' | 'tier'>, rgba: Uint8ClampedArray) =>
  !!s.opaque && s.tier === SatTier.National && whiteCount(rgba) >= WHITE_CHECK_PX && !uniformFill(rgba);

/** The coarse map tile a map tile's mask comes from, and the map tile's cell in its n×n grid. */
export function maskTile(s: Pick<SatSource, 'minZoom'>, z: number, x: number, y: number): NativeTile {
  const mz = Math.max(s.minZoom, Math.min(z, MASK_ZOOM));
  const d = z - mz;
  return { z: mz, x: x >> d, y: y >> d, n: 2 ** d, col: x - ((x >> d) << d), row: y - ((y >> d) << d) };
}

function dilate(m: Uint8Array, r: number): Uint8Array {
  const h = new Uint8Array(m.length);
  const out = new Uint8Array(m.length);
  for (let y = 0; y < MASK_PX; y++) {
    for (let x = 0; x < MASK_PX; x++) {
      if (!m[y * MASK_PX + x]) continue;
      for (let k = Math.max(0, x - r); k <= Math.min(MASK_PX - 1, x + r); k++) h[y * MASK_PX + k] = 1;
    }
  }
  for (let y = 0; y < MASK_PX; y++) {
    for (let x = 0; x < MASK_PX; x++) {
      if (!h[y * MASK_PX + x]) continue;
      for (let k = Math.max(0, y - r); k <= Math.min(MASK_PX - 1, y + r); k++) out[k * MASK_PX + x] = 1;
    }
  }
  return out;
}

/** Fill of a coarse 256 px tile: white pixels whose whole 3×3 block is white, grown by MASK_GROW, then MASK_NEAR at level Near. */
export function fillMask(rgba: Uint8ClampedArray): Uint8Array {
  const w = new Uint8Array(MASK_PX * MASK_PX);
  for (let i = 0; i < w.length; i++) w[i] = isWhite(rgba, i * 4) ? 1 : 0;
  // Off-tile counts as white so fill touching the edge survives erosion.
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= MASK_PX || y >= MASK_PX ? 1 : w[y * MASK_PX + x]);
  const core = new Uint8Array(w.length);
  for (let y = 0; y < MASK_PX; y++) {
    for (let x = 0; x < MASK_PX; x++) {
      let all = 1;
      for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1 && all; dx++) all = at(x + dx, y + dy);
      core[y * MASK_PX + x] = all;
    }
  }
  const fill = dilate(core, MASK_GROW);
  const near = dilate(core, MASK_NEAR);
  for (let i = 0; i < near.length; i++) near[i] = fill[i] ? MaskLevel.Fill : near[i] ? MaskLevel.Near : 0;
  return near;
}

/** Clears (alpha 0) a map tile's white inside its coarse tile's fill mask, and the bright ringing beside it; returns pixels cleared. */
export function clearFill(rgba: Uint8ClampedArray, mask: Uint8Array, cell: Pick<NativeTile, 'n' | 'col' | 'row'>): number {
  const side = Math.round(Math.sqrt(rgba.length / 4));
  const white = (x: number, y: number) => x < 0 || y < 0 || x >= side || y >= side || isWhite(rgba, (y * side + x) * 4);
  const flat = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!white(x + dx, y + dy)) return false;
    return true;
  };
  const gone = new Uint8Array(side * side);
  const depth = new Uint8Array(side * side);
  const queue: number[] = [];
  for (let y = 0; y < side; y++) {
    const my = Math.floor(((cell.row + y / side) * MASK_PX) / cell.n);
    for (let x = 0; x < side; x++) {
      const mx = Math.floor(((cell.col + x / side) * MASK_PX) / cell.n);
      const p = y * side + x;
      const m = mask[my * MASK_PX + mx];
      if (m === MaskLevel.Fill ? !white(x, y) : m !== MaskLevel.Near || !flat(x, y, 2)) continue;
      gone[p] = 1;
      queue.push(p);
    }
  }
  // The coarse mask lags the fill's edge by a few blocks: flood on through flat white joined to it.
  for (let i = 0; i < queue.length; i++) {
    if (depth[queue[i]] >= FLOOD_MAX) continue;
    const x = queue[i] % side;
    const y = (queue[i] - x) / side;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      const q = ny * side + nx;
      if (nx < 0 || ny < 0 || nx >= side || ny >= side || gone[q] || !flat(nx, ny, 1)) continue;
      gone[q] = 1;
      depth[q] = depth[queue[i]] + 1;
      queue.push(q);
    }
  }
  for (let pass = 0; pass < FRINGE_PASSES; pass++) {
    const edge: number[] = [];
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const p = y * side + x;
        if (gone[p] || !isWhite(rgba, p * 4, FRINGE_MIN)) continue;
        if ((x > 0 && gone[p - 1]) || (x < side - 1 && gone[p + 1]) || (y > 0 && gone[p - side]) || (y < side - 1 && gone[p + side])) edge.push(p);
      }
    }
    for (const p of edge) gone[p] = 1;
  }
  let n = 0;
  for (let p = 0; p < gone.length; p++) {
    if (!gone[p]) continue;
    rgba[p * 4 + 3] = 0;
    n++;
  }
  return n;
}

// --- debug stats --------------------------------------------------------

/** Thickness of the thickest opaque white area: the side of the largest all-white square. */
export function whiteRun(rgba: Uint8ClampedArray): number {
  const side = Math.round(Math.sqrt(rgba.length / 4));
  const sq = new Uint16Array(side * side);
  let most = 0;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const p = y * side + x;
      if (!rgba[p * 4 + 3] || !isWhite(rgba, p * 4)) continue;
      sq[p] = x && y ? 1 + Math.min(sq[p - 1], sq[p - side], sq[p - side - 1]) : 1;
      most = Math.max(most, sq[p]);
    }
  }
  return most;
}

/** Mean luminance step between opaque horizontal neighbours: low for blurry or blocky upsampled imagery. */
export function detailOf(rgba: Uint8ClampedArray): number {
  const side = Math.round(Math.sqrt(rgba.length / 4));
  const lum = (i: number) => 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  let sum = 0;
  let n = 0;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side - 1; x++) {
      const i = (y * side + x) * 4;
      if (!rgba[i + 3] || !rgba[i + 7]) continue;
      sum += Math.abs(lum(i + 4) - lum(i));
      n++;
    }
  }
  return n ? sum / n : 0;
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
    const text = creditFor(s, zi);
    if (!out.includes(text)) out.push(text);
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
