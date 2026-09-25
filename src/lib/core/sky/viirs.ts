/** NASA Black Marble VNP46A4 (annual VIIRS night lights) tiles: naming, coverage and the stored raster. */

import type { LngLat } from '@core/geo/geodesy';

export const VIIRS_TILE_PX = 2400;
/** 15 arc-second pixels. */
export const VIIRS_PX_PER_DEG = 240;
export const VIIRS_COLS = 360 * VIIRS_PX_PER_DEG;
export const VIIRS_ROWS = 180 * VIIRS_PX_PER_DEG;
/** Stored rasters keep VNP46A4's own quantum: 0.1 nW/(cm²·sr) per count. */
export const VIIRS_SCALE = 0.1;
export const VIIRS_FIRST_YEAR = 2012;
/** Light farther than this adds < 1 % to any zenith in the model. */
export const VIIRS_MARGIN_KM = 300;
export const LAADS_ROOT = 'https://ladsweb.modaps.eosdis.nasa.gov/archive/allData/5200/VNP46A4';
export const EARTHDATA_SIGNUP = 'https://urs.earthdata.nasa.gov/users/new';

export const laadsListingUrl = (year: number): string => `${LAADS_ROOT}/${year}/001.json`;
export const laadsFileUrl = (year: number, name: string): string => `${LAADS_ROOT}/${year}/001/${name}`;
/** The year's directory, where a signed-in browser downloads tiles by hand. */
export const laadsYearUrl = (year: number): string => `${LAADS_ROOT}/${year}/001/`;

export interface TileId {
  h: number;
  v: number;
}

export const tileName = (t: TileId): string => `h${String(t.h).padStart(2, '0')}v${String(t.v).padStart(2, '0')}`;

export function tileOf(p: LngLat): TileId {
  const h = Math.min(35, Math.max(0, Math.floor((p.lng + 180) / 10)));
  const v = Math.min(17, Math.max(0, Math.floor((90 - p.lat) / 10)));
  return { h, v };
}

export interface ViirsFileName {
  year: number;
  tile: TileId;
}

/** Year and tile from a LAADS file name such as `VNP46A4.A2024001.h18v03.002.2025161220719.h5`. */
export function parseViirsName(name: string): ViirsFileName | null {
  const m = /VNP46A4\.A(\d{4})001\.h(\d{2})v(\d{2})/.exec(name);
  if (!m) return null;
  return { year: Number(m[1]), tile: { h: Number(m[2]), v: Number(m[3]) } };
}

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON = 111.32;

/** The bbox grown by `km` on every side, with longitudes widened for the bbox's most poleward latitude. */
export function growBbox(b: Bbox, km: number): Bbox {
  const dLat = km / KM_PER_DEG_LAT;
  const lat = Math.min(85, Math.max(Math.abs(b.south), Math.abs(b.north)) + dLat);
  const dLon = Math.min(180, km / (KM_PER_DEG_LON * Math.cos((lat * Math.PI) / 180)));
  return { west: Math.max(-180, b.west - dLon), east: Math.min(180, b.east + dLon), south: Math.max(-90, b.south - dLat), north: Math.min(90, b.north + dLat) };
}

export function tilesForBbox(b: Bbox): TileId[] {
  const a = tileOf({ lat: b.north, lng: b.west });
  const z = tileOf({ lat: b.south, lng: b.east - 1e-9 });
  const out: TileId[] = [];
  for (let v = a.v; v <= z.v; v++) for (let h = a.h; h <= z.h; h++) out.push({ h, v });
  return out;
}

export const pointBbox = (p: LngLat): Bbox => ({ west: p.lng, east: p.lng, south: p.lat, north: p.lat });

/** A window of the global 15″ grid; row 0 is its north edge, column 0 its west edge. */
export interface ViirsWindow {
  row0: number;
  col0: number;
  rows: number;
  cols: number;
  /** Counts of VIIRS_SCALE nW/(cm²·sr); 0 where there is no data or no light. */
  data: Uint16Array;
}

/** Global pixel rows and columns covering `km` around a point; columns may run past ±180° and wrap. */
export function windowAround(p: LngLat, km: number): Omit<ViirsWindow, 'data'> {
  const b = growBbox(pointBbox(p), km);
  const row0 = Math.max(0, Math.floor((90 - b.north) * VIIRS_PX_PER_DEG));
  const row1 = Math.min(VIIRS_ROWS, Math.ceil((90 - b.south) * VIIRS_PX_PER_DEG));
  const dLon = Math.min(180, km / (KM_PER_DEG_LON * Math.cos((Math.min(85, Math.abs(p.lat) + km / KM_PER_DEG_LAT) * Math.PI) / 180)));
  const col0 = Math.floor((p.lng - dLon + 180) * VIIRS_PX_PER_DEG);
  const col1 = Math.ceil((p.lng + dLon + 180) * VIIRS_PX_PER_DEG);
  return { row0, col0, rows: row1 - row0, cols: col1 - col0 };
}

/** Tiles a window touches, with wrapped longitudes folded back into 0–35. */
export function tilesForWindow(w: Omit<ViirsWindow, 'data'>): TileId[] {
  const out: TileId[] = [];
  const v0 = Math.floor(w.row0 / VIIRS_TILE_PX);
  const v1 = Math.floor((w.row0 + w.rows - 1) / VIIRS_TILE_PX);
  const h0 = Math.floor(w.col0 / VIIRS_TILE_PX);
  const h1 = Math.floor((w.col0 + w.cols - 1) / VIIRS_TILE_PX);
  for (let v = v0; v <= v1; v++) for (let h = h0; h <= h1; h++) out.push({ h: ((h % 36) + 36) % 36, v });
  return out;
}

/** Physical radiance → stored counts: fill, negatives and NaN become 0, the brightest pixels clamp. */
export function toCounts(raw: ArrayLike<number>, scale: number, offset: number, fill: number | null): Uint16Array {
  const out = new Uint16Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (r === fill) continue;
    const v = (r * scale + offset) / VIIRS_SCALE;
    out[i] = v > 0 ? Math.min(65535, Math.round(v)) : 0;
  }
  return out;
}
