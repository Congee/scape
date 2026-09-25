import type { Rgba } from './grid';
import { hourValue, HourlyVar, type PointSeries } from './openMeteo';

/** What the map's cloud overlay shows. */
export const CloudLayer = { Off: 'Off', Total: 'Total', Low: 'Low', Mid: 'Mid', High: 'High', Fog: 'Fog' } as const;
export type CloudLayer = (typeof CloudLayer)[keyof typeof CloudLayer];

export const LAYER_TEXT: Record<CloudLayer, string> = {
  Off: 'Off',
  Total: 'Total cloud',
  Low: 'Low cloud',
  Mid: 'Mid cloud',
  High: 'High cloud',
  Fog: 'Fog & visibility'
};

const COVER: Partial<Record<CloudLayer, HourlyVar>> = {
  Total: HourlyVar.Cloud,
  Low: HourlyVar.CloudLow,
  Mid: HourlyVar.CloudMid,
  High: HourlyVar.CloudHigh
};

/** Visibility at or above this reads as no haze. */
export const CLEAR_VIS_M = 10_000;
const FOG_VIS_M = 1000;

/** Cover 0..100 for cloud layers; for Fog, 0 (clear air) to 1 (fog reported or visibility < 1 km). NaN when unknown. */
export function layerValue(layer: CloudLayer, s: PointSeries | null, ms: number): number {
  if (!s) return NaN;
  const v = COVER[layer];
  if (v) return hourValue(s, v, ms);
  const code = hourValue(s, HourlyVar.Code, ms);
  if (code === 45 || code === 48) return 1;
  const vis = hourValue(s, HourlyVar.Visibility, ms);
  if (Number.isNaN(vis)) return NaN;
  return Math.min(1, Math.max(0, (CLEAR_VIS_M - vis) / (CLEAR_VIS_M - FOG_VIS_M)));
}

// Mid slate reads on both light and dark basemaps; white vanishes on light ones.
const CLOUD: Rgba = [96, 112, 140, 0.85];
const FOG: Rgba = [232, 197, 71, 0.85];
const GAP: readonly [number, number, number] = [200, 60, 90];

export function layerColor(layer: CloudLayer, v: number): Rgba {
  if (layer === CloudLayer.Fog) return v < 0.02 ? [0, 0, 0, 0] : [FOG[0], FOG[1], FOG[2], FOG[3] * (0.2 + 0.8 * v)];
  return [CLOUD[0], CLOUD[1], CLOUD[2], (CLOUD[3] * Math.min(100, Math.max(0, v))) / 100];
}

/** Diagonal hatch for cells without data: visibly not clear. */
export function gapColor(x: number, y: number): Rgba {
  return [GAP[0], GAP[1], GAP[2], (x + y) % 8 < 2 ? 0.6 : 0.18];
}

/** CSS gradient stops for the legend. */
export function legendGradient(layer: CloudLayer): string {
  const c = (v: number) => {
    const [r, g, b, a] = layerColor(layer, v);
    return `rgba(${r},${g},${b},${a.toFixed(2)})`;
  };
  const max = layer === CloudLayer.Fog ? 1 : 100;
  return `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map((t) => c(t * max)).join(', ')})`;
}
