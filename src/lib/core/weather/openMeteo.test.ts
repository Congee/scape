import { describe, expect, it } from 'vitest';
import { forecastBody } from './fixture';
import { callWeight, CLOUD_VARS, forecastUrl, forecastWindow, hourValue, HourlyVar, lacks, parseForecast, POINT_VARS, valueAt, windowDays } from './openMeteo';

const NOW = Date.parse('2026-09-25T10:00:00Z');

describe('forecastWindow', () => {
  it('covers the GMT dates of a local day', () => {
    // Amsterdam day in summer time: 22:00Z to 22:00Z.
    expect(forecastWindow(Date.parse('2026-09-25T22:00:00Z'), Date.parse('2026-09-26T22:00:00Z'), NOW)).toEqual({ startDate: '2026-09-25', endDate: '2026-09-26' });
  });
  it('clips to the served range and refuses a day outside it', () => {
    expect(forecastWindow(Date.parse('2026-10-10T12:00:00Z'), Date.parse('2026-10-11T12:00:00Z'), NOW)).toEqual({ startDate: '2026-10-10', endDate: '2026-10-10' });
    expect(forecastWindow(Date.parse('2026-10-12T00:00:00Z'), Date.parse('2026-10-13T00:00:00Z'), NOW)).toBeNull();
    expect(forecastWindow(Date.parse('2026-06-01T00:00:00Z'), Date.parse('2026-06-02T00:00:00Z'), NOW)).toBeNull();
    expect(windowDays({ startDate: '2026-09-25', endDate: '2026-09-26' })).toBe(2);
  });
});

describe('forecastUrl', () => {
  it('batches points as comma lists in GMT', () => {
    const url = new URL(forecastUrl([{ lng: 4.47, lat: 51.92 }, { lng: 5, lat: 52 }], 'best_match', CLOUD_VARS, { startDate: '2026-09-25', endDate: '2026-09-25' }));
    expect(url.searchParams.get('latitude')).toBe('51.920,52.000');
    expect(url.searchParams.get('longitude')).toBe('4.470,5.000');
    expect(url.searchParams.get('timezone')).toBe('GMT');
    expect(url.searchParams.get('hourly')?.split(',')).toEqual([...CLOUD_VARS]);
    expect(url.search).not.toContain('%2C');
  });
  it('weights calls like Open-Meteo', () => {
    expect(callWeight(1, 13, 2)).toBeCloseTo(1.3);
    expect(callWeight(30, 6, 1)).toBe(30);
    expect(callWeight(1, 15, 28)).toBeCloseTo(3);
  });
});

describe('parseForecast', () => {
  const pts = [{ lat: 51.92, lng: 4.47 }, { lat: 52, lng: 5 }];
  const body = forecastBody(pts, '2026-09-25', 48, POINT_VARS, (v, h, i) => (v === HourlyVar.Visibility ? null : h >= 40 ? null : h * 2 + i));
  const [a, b] = parseForecast(body, POINT_VARS);

  it('keeps order, times and gaps', () => {
    expect(a.startMs).toBe(Date.parse('2026-09-25T00:00:00Z'));
    expect(a.hours).toBe(48);
    expect(b.values.cloud_cover?.[3]).toBe(7);
    expect(Number.isNaN(a.values.cloud_cover![45])).toBe(true);
  });
  it('interpolates between hours and refuses a gap', () => {
    expect(valueAt(a, HourlyVar.Cloud, a.startMs + 1.5 * 3_600_000)).toBeCloseTo(3);
    expect(valueAt(a, HourlyVar.Cloud, a.startMs + 39.5 * 3_600_000)).toBeNaN();
    expect(valueAt(a, HourlyVar.Cloud, a.startMs - 1)).toBeNaN();
    expect(hourValue(a, HourlyVar.Code, a.startMs + 2.6 * 3_600_000)).toBe(6);
  });
  it('reports a variable the model lacks', () => {
    expect(lacks(a, HourlyVar.Visibility)).toBe(true);
    expect(lacks(a, HourlyVar.Cloud)).toBe(false);
  });
  it('throws the API reason', () => {
    expect(() => parseForecast({ error: true, reason: "Parameter 'start_date' is out of allowed range" }, POINT_VARS)).toThrow(/out of allowed range/);
  });
  it('reads a single-point body', () => {
    expect(parseForecast(forecastBody([pts[0]], '2026-09-25', 24, CLOUD_VARS, () => 1), CLOUD_VARS)).toHaveLength(1);
  });
});
