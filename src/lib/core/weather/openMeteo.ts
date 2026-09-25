import type { LngLat } from '@core/geo/geodesy';

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const ATTRIBUTION_URL = 'https://open-meteo.com/';
export const ATTRIBUTION = 'Weather data by Open-Meteo.com';

export const HourlyVar = {
  Cloud: 'cloud_cover',
  CloudLow: 'cloud_cover_low',
  CloudMid: 'cloud_cover_mid',
  CloudHigh: 'cloud_cover_high',
  Visibility: 'visibility',
  Code: 'weather_code',
  Precip: 'precipitation',
  PrecipProb: 'precipitation_probability',
  Temp: 'temperature_2m',
  Dew: 'dew_point_2m',
  Humidity: 'relative_humidity_2m',
  Wind: 'wind_speed_10m',
  Gust: 'wind_gusts_10m'
} as const;
export type HourlyVar = (typeof HourlyVar)[keyof typeof HourlyVar];

export const POINT_VARS: readonly HourlyVar[] = Object.values(HourlyVar);
export const CLOUD_VARS: readonly HourlyVar[] = [HourlyVar.Cloud, HourlyVar.CloudLow, HourlyVar.CloudMid, HourlyVar.CloudHigh, HourlyVar.Visibility, HourlyVar.Code];

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** The API serves today−92 d to today+15 d; anything outside is an error. */
export const PAST_DAYS = 92;
export const FUTURE_DAYS = 15;

/** Hourly series for one point; missing values are NaN. */
export interface PointSeries {
  lat: number;
  lng: number;
  startMs: number;
  hours: number;
  values: Partial<Record<HourlyVar, Float32Array>>;
}

export interface DateWindow {
  startDate: string;
  endDate: string;
}

export const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dateMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** GMT dates covering [startMs, endMs), clipped to what the API serves; null when none of it is. */
export function forecastWindow(startMs: number, endMs: number, nowMs: number): DateWindow | null {
  const today = dateMs(isoDate(nowMs));
  const first = Math.max(dateMs(isoDate(startMs)), today - PAST_DAYS * DAY_MS);
  const last = Math.min(dateMs(isoDate(Math.max(startMs, endMs - 1))), today + FUTURE_DAYS * DAY_MS);
  return first > last ? null : { startDate: isoDate(first), endDate: isoDate(last) };
}

export const windowDays = (w: DateWindow) => Math.round((dateMs(w.endDate) - dateMs(w.startDate)) / DAY_MS) + 1;

/** Open-Meteo counts >10 variables or >2 weeks per location as a fractional extra call. */
export const callWeight = (locations: number, vars: number, days: number) => locations * Math.max(1, vars / 10) * Math.max(1, days / 14);

export const roundCoord = (v: number, step = 0.01) => Math.round(v / step) * step;

export function forecastUrl(points: readonly LngLat[], model: string, vars: readonly HourlyVar[], w: DateWindow): string {
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(3)).join(','),
    longitude: points.map((p) => p.lng.toFixed(3)).join(','),
    hourly: vars.join(','),
    models: model,
    timezone: 'GMT',
    cell_selection: 'nearest',
    start_date: w.startDate,
    end_date: w.endDate
  });
  return `${FORECAST_URL}?${q.toString().replaceAll('%2C', ',')}`;
}

interface RawPoint {
  latitude: number;
  longitude: number;
  hourly?: Record<string, (number | null)[] | string[]>;
}

/** One series per requested point, in order; throws the API's reason on an error body. */
export function parseForecast(json: unknown, vars: readonly HourlyVar[]): PointSeries[] {
  if (json && typeof json === 'object' && 'error' in json && (json as { error: unknown }).error) {
    throw new Error(`Open-Meteo: ${String((json as { reason?: unknown }).reason ?? 'error')}`);
  }
  const list = (Array.isArray(json) ? json : [json]) as RawPoint[];
  return list.map((raw) => {
    const time = (raw.hourly?.time ?? []) as string[];
    const values: PointSeries['values'] = {};
    for (const v of vars) {
      const src = raw.hourly?.[v] as (number | null)[] | undefined;
      if (!src) continue;
      const arr = new Float32Array(time.length);
      for (let i = 0; i < time.length; i++) arr[i] = src[i] ?? NaN;
      values[v] = arr;
    }
    return { lat: raw.latitude, lng: raw.longitude, startMs: time.length ? Date.parse(`${time[0]}Z`) : 0, hours: time.length, values };
  });
}

/** Value at `ms`, linear between hours; NaN when a neighbour is missing or out of range. */
export function valueAt(s: PointSeries, v: HourlyVar, ms: number): number {
  const arr = s.values[v];
  if (!arr) return NaN;
  const f = (ms - s.startMs) / HOUR_MS;
  const i = Math.floor(f);
  if (i < 0 || i >= s.hours) return NaN;
  const t = f - i;
  if (t === 0 || i + 1 >= s.hours) return t === 0 ? arr[i] : NaN;
  return arr[i] + (arr[i + 1] - arr[i]) * t;
}

/** Value of the hour containing `ms`, for codes that must not be blended. */
export function hourValue(s: PointSeries, v: HourlyVar, ms: number): number {
  const i = Math.round((ms - s.startMs) / HOUR_MS);
  const arr = s.values[v];
  return arr && i >= 0 && i < s.hours ? arr[i] : NaN;
}

/** True when the model returned the variable nowhere in the series. */
export function lacks(s: PointSeries, v: HourlyVar): boolean {
  const arr = s.values[v];
  return !arr || arr.every(Number.isNaN);
}
