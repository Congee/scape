import { geodesicLine, heightAtAngle, type LngLat } from '@core/geo/geodesy';
import { FogClass, fogSigns } from './fog';
import { pct } from './format';
import { hourValue, HourlyVar, valueAt, type PointSeries } from './openMeteo';

/** Cloud samples toward the Sun, km from the point. */
export const GLOW_KM = [25, 50, 100, 200, 300] as const;
/** Sun bearings share samples within this bin. */
export const AZ_BIN_DEG = 2;
/** Open-Meteo's band tops: low up to 2 km, mid 2–6 km, high above. */
export const LOW_TOP_M = 2000;
export const MID_TOP_M = 6000;
/** High cloud overhead in this range catches the light. */
export const CANVAS_PCT = [20, 70] as const;
/** From this day on (0 = today), forecasts are shaky. */
export const LOW_CONFIDENCE_DAY = 3;
/** Losses below this do not earn a reason of their own. */
const REASON_MIN_PCT = 20;

export const CloudLayer = { Low: 'low', Mid: 'mid' } as const;
export type CloudLayer = (typeof CloudLayer)[keyof typeof CloudLayer];

export const binBearing = (azDeg: number) => (((Math.round(azDeg / AZ_BIN_DEG) * AZ_BIN_DEG) % 360) + 360) % 360;

/** The point, then GLOW_KM samples along each bearing's geodesic. */
export function glowPoints(point: LngLat, bearings: readonly number[]): LngLat[] {
  const out: LngLat[] = [point];
  for (const b of bearings) {
    const line = geodesicLine(point, b);
    for (const km of GLOW_KM) out.push(line(km * 1000));
  }
  return out;
}

/** Index of the first path sample for `bearings[i]` in `glowPoints`. */
export const pathOffset = (i: number) => 1 + i * GLOW_KM.length;

/** The cloud band a height sits in; null above the mid band. */
export const layerAt = (m: number): CloudLayer | null => (m < LOW_TOP_M ? CloudLayer.Low : m < MID_TOP_M ? CloudLayer.Mid : null);

const LAYER_VAR: Record<CloudLayer, HourlyVar> = { low: HourlyVar.CloudLow, mid: HourlyVar.CloudMid };

export interface GlowInput {
  /** Point's ground height, m. */
  groundM: number;
  /** Height of the sunlight path's start above the ground, m. */
  eyeM: number;
  /** Apparent altitude of the Sun, degrees. */
  sunAltDeg: number;
  ms: number;
  point: PointSeries;
  /** One series per GLOW_KM entry, in order. */
  path: readonly PointSeries[];
}

export interface GlowScore {
  /** 0–100; null when the forecast lacks a value the score needs. */
  score: number | null;
  reason: string;
}

/** Chance of alpenglow: low or mid cloud on the sunlight path blocks it, low cloud or fog at the point hides it. */
export function scoreGlow(x: GlowInput): GlowScore {
  const none = { score: null, reason: 'no forecast for this time' };
  let path = 0;
  let pathLayer: CloudLayer = CloudLayer.Low;
  let pathKm = 0;
  for (let i = 0; i < GLOW_KM.length; i++) {
    const layer = layerAt(heightAtAngle(x.groundM + x.eyeM, GLOW_KM[i] * 1000, x.sunAltDeg));
    if (!layer) continue;
    const c = valueAt(x.path[i], LAYER_VAR[layer], x.ms);
    if (Number.isNaN(c)) return none;
    if (c > path) [path, pathLayer, pathKm] = [c, layer, GLOW_KM[i]];
  }

  const fog = fogSigns({ code: hourValue(x.point, HourlyVar.Code, x.ms), visibilityM: valueAt(x.point, HourlyVar.Visibility, x.ms), tempC: NaN, dewC: NaN, lowCloud: NaN }).cls === FogClass.Fog;
  const hideLayer = layerAt(x.groundM);
  let hide = 0;
  if (fog) hide = 100;
  else if (hideLayer) {
    hide = valueAt(x.point, LAYER_VAR[hideLayer], x.ms);
    if (Number.isNaN(hide)) return none;
  }

  const high = valueAt(x.point, HourlyVar.CloudHigh, x.ms);
  const canvas = high >= CANVAS_PCT[0] && high <= CANVAS_PCT[1];
  const score = Math.round((1 - path / 100) * (1 - hide / 100) * (85 + (canvas ? 15 : 0)));

  let reason: string;
  if (Math.max(path, hide) < REASON_MIN_PCT) reason = canvas ? `clear toward the Sun, high cloud ${pct(high)} overhead` : 'clear toward the Sun';
  else if (hide >= path) reason = fog ? 'fog at the point' : `${hideLayer} cloud ${pct(hide)} at the point`;
  else reason = `${pathLayer} cloud ${pct(path)} toward the Sun, ${pathKm} km`;
  return { score, reason };
}
