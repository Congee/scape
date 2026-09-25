/** Calibration's radial histogram (scripts/viirs/calibrate.ts): radiance·area by distance, so every λ reuses one pass. */

import type { LngLat } from '@core/geo/geodesy';
import { KM_PER_DEG_LAT, KM_PER_DEG_LON, kernel, REACH_KM } from './skyglow';
import { VIIRS_PX_PER_DEG, type ViirsWindow } from './viirs';

/** A window with its own quantum and saturation count (GIBS), or VNP46A4's. */
export interface Win extends ViirsWindow {
  scale: number;
  satCount: number;
}

export const BIN_KM = 0.05;
export interface Hist {
  /** Radiance·area by distance bin, unsaturated and saturated pixels apart, so every λ and gain reuses one pass. */
  lit: Float64Array;
  sat: Float64Array;
  /** Radiance of the observer's own pixel, nW/(cm²·sr). */
  local: number;
}

export function radialHistogram(win: Win, s: LngLat): Hist {
  const lit = new Float64Array(Math.ceil(REACH_KM / BIN_KM));
  const sat = new Float64Array(lit.length);
  const d2r = Math.PI / 180;
  const px = 1 / VIIRS_PX_PER_DEG;
  const kx = KM_PER_DEG_LON * Math.cos(s.lat * d2r);
  for (let r = 0; r < win.rows; r++) {
    const pLat = 90 - (win.row0 + r + 0.5) * px;
    const dy = (pLat - s.lat) * KM_PER_DEG_LAT;
    const area = px * KM_PER_DEG_LAT * px * KM_PER_DEG_LON * Math.cos(pLat * d2r);
    for (let c = 0; c < win.cols; c++) {
      const v = win.data[r * win.cols + c];
      if (!v) continue;
      let dLon = (win.col0 + c + 0.5) * px - 180 - s.lng;
      dLon -= 360 * Math.round(dLon / 360);
      const i = Math.floor(Math.hypot(dLon * kx, dy) / BIN_KM);
      if (i < lit.length) (v >= win.satCount ? sat : lit)[i] += v * win.scale * area;
    }
  }
  const r = Math.floor((90 - s.lat) * VIIRS_PX_PER_DEG) - win.row0;
  const c = Math.floor((s.lng + 180) * VIIRS_PX_PER_DEG) - win.col0;
  return { lit, sat, local: win.data[r * win.cols + c] * win.scale };
}

/** Σ bin·kernel at each bin's centre distance. */
export const histSum = (h: Float64Array, lambda: number): number => h.reduce((a, v, i) => a + v * kernel((i + 0.5) * BIN_KM, lambda), 0);
