import type { HourlyVar } from './openMeteo';

/** An Open-Meteo /v1/forecast body in the API's own shape; `value(var, hour, point)` fills it, null for a gap. */
export function forecastBody(
  points: { lat: number; lng: number }[],
  startDate: string,
  hours: number,
  vars: readonly HourlyVar[],
  value: (v: HourlyVar, hour: number, point: number) => number | null
): unknown {
  const t0 = Date.parse(`${startDate}T00:00:00Z`);
  const time = Array.from({ length: hours }, (_, h) => new Date(t0 + h * 3_600_000).toISOString().slice(0, 16));
  const body = points.map((p, i) => ({
    latitude: p.lat,
    longitude: p.lng,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone: 'GMT',
    timezone_abbreviation: 'GMT',
    elevation: 0,
    hourly_units: { time: 'iso8601' },
    hourly: { time, ...Object.fromEntries(vars.map((v) => [v, time.map((_, h) => value(v, h, i))])) }
  }));
  return body.length === 1 ? body[0] : body;
}
