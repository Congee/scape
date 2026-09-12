import { HeatMode, type HeatModeOn, type HeatResult } from '@workers/align.protocol';

/** Red, green, blue 0..255 with an alpha 0..1. */
export type Rgba = readonly [number, number, number, number];

const CLEAR: Rgba = [0, 0, 0, 0];
const YELLOW: Rgba = [255, 225, 77, 1];
const ORANGE: Rgba = [255, 138, 26, 1];
const VIOLET: Rgba = [76, 29, 149, 1];
const BLUE: Rgba = [59, 130, 246, 1];
const WHITE: Rgba = [255, 255, 255, 1];
const RED: Rgba = [239, 68, 68, 1];
const HIDDEN: Rgba = [27, 42, 74, 0.65];
const SEEN: Rgba = [56, 193, 114, 0.45];

/** Alpha at the colour scale's far edge. */
const FAR_ALPHA = 0.25;

export interface HeatScale {
  toleranceDeg: number;
  windowMin: number;
  capDeg: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mix = (a: Rgba, b: Rgba, t: number): Rgba => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
const withAlpha = (c: Rgba, a: number): Rgba => [c[0], c[1], c[2], a];

/** Position of a separation between the tolerance and the cap, 0..1. */
const fade = (sepDeg: number, s: HeatScale) => (s.capDeg > s.toleranceDeg ? clamp((sepDeg - s.toleranceDeg) / (s.capDeg - s.toleranceDeg), 0, 1) : 1);

export function heatColor(mode: HeatModeOn, value: number, dtMs: number, s: HeatScale): Rgba {
  if (Number.isNaN(value)) return CLEAR;
  if (mode === HeatMode.Viewshed) return value >= 1 ? SEEN : CLEAR;
  if (mode === HeatMode.Visible) return value >= 1 ? CLEAR : HIDDEN;
  const inTolerance = value <= s.toleranceDeg;
  const t = fade(value, s);
  const alpha = inTolerance ? 1 : 1 - (1 - FAR_ALPHA) * t;
  if (mode === HeatMode.Time) {
    const u = clamp(dtMs / Math.max(1, s.windowMin * 60_000), -1, 1);
    return withAlpha(u < 0 ? mix(BLUE, WHITE, u + 1) : mix(WHITE, RED, u), alpha);
  }
  if (inTolerance) return YELLOW;
  return withAlpha(t <= 0.5 ? mix(YELLOW, ORANGE, t * 2) : mix(ORANGE, VIOLET, t * 2 - 1), alpha);
}

/** One pixel per cell, row 0 at the top; returned as a PNG data URL for an image source. */
export function paintHeat(result: HeatResult, o: { toleranceDeg: number; windowMin: number }): string {
  const n = result.grid.n;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  const scale: HeatScale = { ...o, capDeg: result.capDeg };
  for (let i = 0; i < n * n; i++) {
    const [r, g, b, a] = heatColor(result.mode, result.values[i], result.dtMs ? result.dtMs[i] : 0, scale);
    const p = i * 4;
    img.data[p] = Math.round(r);
    img.data[p + 1] = Math.round(g);
    img.data[p + 2] = Math.round(b);
    img.data[p + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}
