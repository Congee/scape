import { EclipseKind, NextLunarEclipse, SearchLocalSolarEclipse, SearchLunarEclipse } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { localMidnight } from '@core/time/localDay';
import { makeObserver, SkyBody } from './bodies';
import { calendarMarks, CalendarMarkKind } from './calendar';
import { position } from './positions';

const HOBOKEN = { lat: 40.748, lng: -74.024 };
const MADRID = { lat: 40.42, lng: -3.7 };
const hoboken = makeObserver(HOBOKEN);
const madrid = makeObserver(MADRID);
const NY = 'America/New_York';
const ES = 'Europe/Madrid';
const DAY_MS = 86_400_000;

const span = (y: number, m: number, d: number, days: number, tz: string) => {
  const from = localMidnight(y, m, d, tz).getTime();
  return [from, from + days * DAY_MS] as const;
};

describe('calendarMarks', () => {
  it('marks the full moon on 2026-10-26 in New York', () => {
    const [from, to] = span(2026, 10, 1, 31, NY);
    const marks = calendarMarks(hoboken, from, to, NY);
    const full = marks.filter((m) => m.kind === CalendarMarkKind.FullMoon);
    expect(full).toHaveLength(1);
    expect(full[0].day).toBe('2026-10-26');
  });

  it('marks the new moon on 2026-10-10 in New York', () => {
    const [from, to] = span(2026, 10, 1, 31, NY);
    const newMoons = calendarMarks(hoboken, from, to, NY).filter((m) => m.kind === CalendarMarkKind.NewMoon);
    expect(newMoons.map((m) => m.day)).toEqual(['2026-10-10']);
  });

  it('walks the four principal phases in cyclic order over 35 days', () => {
    const [from, to] = span(2026, 10, 1, 35, NY);
    const cycle: CalendarMarkKind[] = [CalendarMarkKind.NewMoon, CalendarMarkKind.FirstQuarter, CalendarMarkKind.FullMoon, CalendarMarkKind.LastQuarter];
    const phases = calendarMarks(hoboken, from, to, NY)
      .filter((m) => m.kind !== CalendarMarkKind.SolarEclipse && m.kind !== CalendarMarkKind.LunarEclipse)
      .map((m) => m.kind);
    // 35 days spans one synodic month plus a few, so all four appear and the sequence never skips.
    expect(new Set(phases).size).toBe(4);
    const start = cycle.indexOf(phases[0]);
    expect(phases).toEqual(phases.map((_, i) => cycle[(start + i) % 4]));
  });

  it('marks the 2026-03-03 total lunar eclipse from Hoboken', () => {
    const [from, to] = span(2026, 3, 1, 31, NY);
    const lunar = calendarMarks(hoboken, from, to, NY).filter((m) => m.kind === CalendarMarkKind.LunarEclipse);
    expect(lunar).toHaveLength(1);
    expect(lunar[0].day).toBe('2026-03-03');
    expect(lunar[0].detail).toMatch(/^Total lunar eclipse · max /);
  });

  it('marks the 2026-08-12 solar eclipse from Madrid', () => {
    const [from, to] = span(2026, 8, 1, 31, ES);
    const solar = calendarMarks(madrid, from, to, ES, { hour12: false }).filter((m) => m.kind === CalendarMarkKind.SolarEclipse);
    expect(solar).toHaveLength(1);
    expect(solar[0].day).toBe('2026-08-12');
    // Madrid sits just outside the 2026 path of totality: 99 % obscured, so astronomy-engine calls it partial.
    expect(solar[0].detail).toBe('Partial solar eclipse · max 99 % obscured at 20:32');
  });

  it('marks the 2026-08-12 solar eclipse from Hoboken only while the sun is up there', () => {
    const [from, to] = span(2026, 8, 1, 31, NY);
    const local = SearchLocalSolarEclipse(new Date(from), hoboken);
    const up = local.peak.altitude > 0 || local.partial_begin.altitude > 0 || local.partial_end.altitude > 0;
    const solar = calendarMarks(hoboken, from, to, NY).filter((m) => m.kind === CalendarMarkKind.SolarEclipse);
    expect(solar.length > 0).toBe(up);
    if (up) expect(solar[0].timeMs).toBeCloseTo(local.peak.time.date.getTime(), -4);
  });

  it('marks a penumbral eclipse where the moon only rises by the penumbral boundary', () => {
    let le = SearchLunarEclipse(new Date(Date.UTC(2026, 0, 1)));
    while (le.kind !== EclipseKind.Penumbral) le = NextLunarEclipse(le.peak);
    const peak = le.peak.date.getTime();
    const edge = peak + le.sd_penum * 60_000;
    // On the equator, walk east until the moon is still below the horizon at peak but up by the boundary.
    const lng = [...Array(72).keys()]
      .map((i) => -180 + i * 5)
      .find((l) => {
        const o = makeObserver({ lat: 0, lng: l });
        return position(SkyBody.Moon, new Date(peak), o).altitude <= 0 && position(SkyBody.Moon, new Date(edge), o).altitude > 0;
      });
    expect(lng).toBeDefined();
    const obs = makeObserver({ lat: 0, lng: lng! });
    const marks = calendarMarks(obs, peak - DAY_MS, peak + DAY_MS, 'UTC').filter((m) => m.kind === CalendarMarkKind.LunarEclipse);
    expect(marks).toHaveLength(1);
    expect(marks[0].detail).toMatch(/^Penumbral lunar eclipse · max /);
  });

  it('returns marks sorted and inside the window', () => {
    const [from, to] = span(2026, 3, 1, 60, NY);
    const marks = calendarMarks(hoboken, from, to, NY);
    expect(marks.length).toBeGreaterThan(6);
    expect(marks.map((m) => m.timeMs)).toEqual(marks.map((m) => m.timeMs).toSorted((a, b) => a - b));
    for (const m of marks) {
      expect(m.timeMs).toBeGreaterThanOrEqual(from);
      expect(m.timeMs).toBeLessThanOrEqual(to);
    }
  });
});
