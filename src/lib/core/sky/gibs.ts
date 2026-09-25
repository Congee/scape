/**
 * NASA GIBS nightly VIIRS tiles as a sky source: which tiles a point needs, the colormap decode and the per-pixel
 * median of nights on the 15″ grid. Mirrors scripts/viirs/gibs_windows.py, which calibrated it (gibs.md).
 */

import type { LngLat } from '@core/geo/geodesy';
import { KM_PER_DEG_LAT, KM_PER_DEG_LON, REACH_KM } from './skyglow';
import { VIIRS_PX_PER_DEG, windowAround, type ViirsWindow } from './viirs';

export const GIBS_LAYER = 'VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance';
export const gibsTileUrl = (date: string, t: GibsTile): string => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${GIBS_LAYER}/default/${date}/GoogleMapsCompatible_Level8/${t.z}/${t.row}/${t.col}.png`;

export const GIBS_NEAR_ZOOM = 8;
export const GIBS_FAR_ZOOM = 6;
/** Pixels this close read the z8 tiles; farther light is smooth enough for z6. */
export const GIBS_NEAR_KM = 32;
export const GIBS_NIGHTS = 8;
/** Of those, the nights the far (z6) field reads; its light is averaged over the kernel, so fewer nights suffice (gibs.md). */
export const GIBS_FAR_NIGHTS = 2;
/** Days between the nights, as calibrated. */
export const GIBS_NIGHT_STEP_DAYS = 8;
/** The newest night is looked up again after this long. */
export const GIBS_STALE_DAYS = 30;
/** Nights searched back from today for the newest published one. */
export const GIBS_LOOKBACK_DAYS = 10;
/** Output quantum, nW/(cm²·sr) per count; finer than VIIRS_SCALE so the 0.1-wide bottom bins keep their midpoints. */
export const GIBS_SCALE = 0.01;
export const GIBS_TILE_PX = 256;

const DAY_MS = 86_400_000;

// Lower edges of colormap VIIRS_DayNightBand_At_Sensor_Radiance refs 1–180, nW/(cm²·sr); ref i spans [LO[i-1], LO[i]).
// The XML's ref 91 reads [9.8,100), a typo for [9.8,10).
const LO = [
  0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6,
  4.7, 4.8, 4.9, 5.0, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 7, 7.1, 7.2, 7.3, 7.4, 7.6, 7.7, 7.8, 7.9, 8.1, 8.2, 8.3, 8.5, 8.6, 8.8, 8.9, 9, 9.2, 9.3, 9.5, 9.6, 9.8, 10, 10.1,
  10.3, 10.4, 10.6, 10.8, 11, 11.1, 11.3, 11.5, 11.7, 11.8, 12, 12.2, 12.4, 12.6, 12.8, 13, 13.2, 13.4, 13.6, 13.9, 14.1, 14.3, 14.5, 14.7, 15, 15.2, 15.4, 15.7, 15.9, 16.2, 16.4, 16.7, 16.9, 17.2, 17.5, 17.7, 18, 18.3, 18.6,
  18.8, 19.1, 19.4, 19.7, 20, 20.3, 20.7, 21, 21.3, 21.6, 21.9, 22.3, 22.6, 23, 23.3, 23.7, 24, 24.4, 24.8, 25.1, 25.5, 25.9, 26.3, 26.7, 27.1, 27.5, 27.9, 28.3, 28.8, 29.2, 29.6, 30.1, 30.5, 31, 31.5, 31.9, 32.4, 32.9, 33.4,
  33.9, 34.4, 34.9, 35.5, 36, 36.5, 37.1, 37.6, 38.2
];
export const GIBS_NODATA = 0;
/** The open-ended top bin, [38.2, ∞). */
export const GIBS_SATURATED = LO.length;
export const GIBS_SAT_COUNT = Math.round(LO[GIBS_SATURATED - 1] / GIBS_SCALE);

/** Palette index → bin midpoint, nW/(cm²·sr); the saturated bin reads its lower edge, unknown indices 0. */
export const GIBS_RADIANCE: Float64Array = (() => {
  const lut = new Float64Array(256);
  for (let i = 1; i < GIBS_SATURATED; i++) lut[i] = (LO[i - 1] + LO[i]) / 2;
  lut[GIBS_SATURATED] = LO[GIBS_SATURATED - 1];
  return lut;
})();

export interface GibsTile {
  z: number;
  row: number;
  col: number;
}

export const gibsTileKey = (t: GibsTile): string => `${t.z}/${t.row}/${t.col}`;

/** Web Mercator pixel row at zoom z, latitude clipped as GIBS tiles are. */
export function mercY(lat: number, z: number): number {
  const phi = (Math.min(85.05, Math.max(-85.05, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * GIBS_TILE_PX * 2 ** z);
}

export function mercX(lng: number, z: number): number {
  const f = (lng + 180) / 360;
  return Math.floor((f - Math.floor(f)) * GIBS_TILE_PX * 2 ** z);
}

/** One zoom's lookup: tile slot and in-tile offset per window row and column. */
interface ZoomAxes {
  z: number;
  rowSlot: Int32Array;
  rowOff: Int32Array;
  colSlot: Int32Array;
  colOff: Int32Array;
  /** Tile rows and columns by slot. */
  tileRows: number[];
  tileCols: number[];
}

export interface GibsPlan {
  p: LngLat;
  win: Omit<ViirsWindow, 'data'>;
  near: ZoomAxes;
  far: ZoomAxes;
  /** Squared distance per window row and column from the point, km², for the near/far split. */
  dy2: Float64Array;
  dx2: Float64Array;
  /** Tiles holding at least one window pixel at their zoom, near first. */
  tiles: GibsTile[];
}

function axes(z: number, n: number, at: (i: number) => number): { slot: Int32Array; off: Int32Array; tiles: number[] } {
  const slot = new Int32Array(n);
  const off = new Int32Array(n);
  const tiles: number[] = [];
  for (let i = 0; i < n; i++) {
    const px = at(i);
    const t = Math.floor(px / GIBS_TILE_PX);
    let s = tiles.indexOf(t);
    if (s < 0) s = tiles.push(t) - 1;
    slot[i] = s;
    off[i] = px - t * GIBS_TILE_PX;
  }
  return { slot, off, tiles };
}

/** Per tile slot: nearest and farthest squared distance along one axis. */
function span(slots: Int32Array, n: number, d2: Float64Array): { lo: Float64Array; hi: Float64Array } {
  const lo = new Float64Array(n).fill(Infinity);
  const hi = new Float64Array(n).fill(-Infinity);
  for (let i = 0; i < slots.length; i++) {
    lo[slots[i]] = Math.min(lo[slots[i]], d2[i]);
    hi[slots[i]] = Math.max(hi[slots[i]], d2[i]);
  }
  return { lo, hi };
}

/** Tiles and lookups for the window around a point; the window defaults to the model's reach, as calibrated. */
export function gibsPlan(p: LngLat, win: Omit<ViirsWindow, 'data'> = windowAround(p, REACH_KM)): GibsPlan {
  const lat = (r: number) => 90 - (win.row0 + r + 0.5) / VIIRS_PX_PER_DEG;
  const lng = (c: number) => (win.col0 + c + 0.5) / VIIRS_PX_PER_DEG - 180;
  const kx = KM_PER_DEG_LON * Math.cos((p.lat * Math.PI) / 180);
  const dy2 = new Float64Array(win.rows).map((_, r) => ((lat(r) - p.lat) * KM_PER_DEG_LAT) ** 2);
  const dx2 = new Float64Array(win.cols).map((_, c) => {
    const d = lng(c) - p.lng;
    return ((d - 360 * Math.round(d / 360)) * kx) ** 2;
  });
  const zoom = (z: number): ZoomAxes => {
    const r = axes(z, win.rows, (i) => mercY(lat(i), z));
    const c = axes(z, win.cols, (i) => mercX(lng(i), z));
    return { z, rowSlot: r.slot, rowOff: r.off, colSlot: c.slot, colOff: c.off, tileRows: r.tiles, tileCols: c.tiles };
  };
  const near = zoom(GIBS_NEAR_ZOOM);
  const far = zoom(GIBS_FAR_ZOOM);
  const near2 = GIBS_NEAR_KM * GIBS_NEAR_KM;
  const tiles: GibsTile[] = [];
  for (const a of [near, far]) {
    const ry = span(a.rowSlot, a.tileRows.length, dy2);
    const cx = span(a.colSlot, a.tileCols.length, dx2);
    for (let i = 0; i < a.tileRows.length; i++)
      for (let j = 0; j < a.tileCols.length; j++) {
        const has = a === near ? ry.lo[i] + cx.lo[j] <= near2 : ry.hi[i] + cx.hi[j] > near2;
        if (has) tiles.push({ z: a.z, row: a.tileRows[i], col: a.tileCols[j] });
      }
  }
  return { p, win, near, far, dy2, dx2, tiles };
}

/** k of n night indices, newest first, spread from the newest to the oldest to decorrelate cloud and moon. */
export function gibsFarNights(n = GIBS_NIGHTS, k = GIBS_FAR_NIGHTS): number[] {
  if (k >= n) return Array.from({ length: n }, (_, i) => i);
  if (k <= 1) return [0];
  return Array.from({ length: k }, (_, i) => Math.floor((i * (n - 1)) / (k - 1) + 0.5));
}

/** Tiles each of n nights needs: all near tiles, far tiles only on the far nights. */
export function gibsNightTiles(plan: GibsPlan, n: number, far = gibsFarNights(n)): GibsTile[][] {
  const near = plan.tiles.filter((t) => t.z === plan.near.z);
  return Array.from({ length: n }, (_, i) => (far.includes(i) ? plan.tiles : near));
}

/** A night's decoded tiles by gibsTileKey: palette indices, or null where the night has no tile. */
export type GibsNight = ReadonlyMap<string, Uint8Array | null>;

const roundHalfEven = (x: number) => {
  const r = Math.round(x);
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

export interface GibsWindow extends ViirsWindow {
  scale: number;
  /** Counts at or above this are saturated pixels. */
  satCount: number;
}

/** Per-pixel median of the nights' radiance bins (no data left out), in GIBS_SCALE counts; far pixels read only the far nights. */
export function medianWindow(plan: GibsPlan, nights: readonly GibsNight[], farNights = gibsFarNights(nights.length)): GibsWindow {
  const { win, near, far, dy2, dx2 } = plan;
  const grid = (a: ZoomAxes) =>
    nights.map((n) => {
      const g: (Uint8Array | null)[] = [];
      for (const row of a.tileRows) for (const col of a.tileCols) g.push(n.get(gibsTileKey({ z: a.z, row, col })) ?? null);
      return g;
    });
  const nearGrid = grid(near);
  const farGrid = grid(far);
  const data = new Uint16Array(win.rows * win.cols);
  const buf = new Uint8Array(nights.length);
  const all = nights.map((_, i) => i);
  const near2 = GIBS_NEAR_KM * GIBS_NEAR_KM;
  for (let r = 0; r < win.rows; r++)
    for (let c = 0; c < win.cols; c++) {
      const isNear = dy2[r] + dx2[c] <= near2;
      const a = isNear ? near : far;
      const g = isNear ? nearGrid : farGrid;
      const use = isNear ? all : farNights;
      const slot = a.rowSlot[r] * a.tileCols.length + a.colSlot[c];
      const off = a.rowOff[r] * GIBS_TILE_PX + a.colOff[c];
      let n = 0;
      for (let i = 0; i < use.length; i++) {
        const t = g[use[i]][slot];
        const v = t ? t[off] : GIBS_NODATA;
        // No data sorts last, as 255.
        const x = v === GIBS_NODATA ? 255 : v;
        if (x !== 255) n++;
        let j = i;
        for (; j > 0 && buf[j - 1] > x; j--) buf[j] = buf[j - 1];
        buf[j] = x;
      }
      if (!n) continue;
      const lo = buf[(n - 1) >> 1];
      const hi = buf[n >> 1];
      const i = r * win.cols + c;
      if (lo === GIBS_SATURATED && hi === GIBS_SATURATED) data[i] = GIBS_SAT_COUNT;
      else data[i] = Math.min(GIBS_SAT_COUNT - 1, Math.max(0, roundHalfEven((GIBS_RADIANCE[lo] + GIBS_RADIANCE[hi]) / 2 / GIBS_SCALE)));
    }
  return { ...win, data, scale: GIBS_SCALE, satCount: GIBS_SAT_COUNT };
}

export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The nights to median, newest first. */
export const gibsNights = (newest: string, n = GIBS_NIGHTS, stepDays = GIBS_NIGHT_STEP_DAYS): string[] => Array.from({ length: n }, (_, i) => isoDay(Date.parse(newest) - i * stepDays * DAY_MS));

/** Dates to probe for the newest published night, today first. */
export const probeDates = (nowMs: number, days = GIBS_LOOKBACK_DAYS): string[] => Array.from({ length: days + 1 }, (_, i) => isoDay(nowMs - i * DAY_MS));

/** A newest-night lookup this old (or from the future: a clock change) is looked up again. */
export const isStale = (checkedAtMs: number, nowMs: number, days = GIBS_STALE_DAYS): boolean => !(nowMs >= checkedAtMs && nowMs - checkedAtMs < days * DAY_MS);
