import { Body, Equator, Horizon, SearchAltitude, SearchRiseSet } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { makeObserver, SkyBody } from './bodies';
import { dayEvents, EventKind, type DayEvent } from './dayEvents';
import { moonFreeWindow, nextMoonEvent, nightWindow, NightKind, type NightWindow } from './night';

const hoboken = makeObserver({ lat: 40.747952, lng: -74.023685 });
// Local noon to noon, EDT (UTC-4).
const start = Date.UTC(2026, 9, 26, 16);
const end = Date.UTC(2026, 9, 27, 16);
const now = Date.parse('2026-10-26T23:01:25Z');
const events = dayEvents(hoboken, start, end);

const moonAlt = (ms: number) => {
  const d = new Date(ms);
  const eq = Equator(Body.Moon, d, hoboken, true, true);
  return Horizon(d, hoboken, eq.ra, eq.dec, '').altitude;
};

const ev = (body: SkyBody, kind: EventKind, time: number): DayEvent => ({ body, kind, time, azimuth: 0, altitude: 0 });

describe('nightWindow', () => {
  it('runs from astronomical dusk to astronomical dawn', () => {
    const dusk = SearchAltitude(Body.Sun, hoboken, -1, new Date(start), 1, -18)!;
    const dawn = SearchAltitude(Body.Sun, hoboken, 1, new Date(dusk.date.getTime() + 60_000), 1, -18)!;
    const night = nightWindow(events, now);
    expect(night.kind).toBe(NightKind.Astronomical);
    expect(Math.abs(night.startMs - dusk.date.getTime())).toBeLessThanOrEqual(60_000);
    expect(Math.abs(night.endMs - dawn.date.getTime())).toBeLessThanOrEqual(60_000);
    expect(night.startMs).toBeGreaterThan(start);
    expect(night.endMs).toBeLessThan(end);
  });

  it('reports no darkness under the midnight sun', () => {
    const tromso = makeObserver({ lat: 69.65, lng: 18.96 });
    const midsummer = Date.UTC(2026, 5, 21, 10);
    const next = midsummer + 86_400_000;
    expect(SearchAltitude(Body.Sun, tromso, -1, new Date(midsummer), 1, -12)).toBeNull();
    expect(nightWindow(dayEvents(tromso, midsummer, next), midsummer).kind).toBe(NightKind.None);
  });

  it('falls back to nautical when the sun never reaches −18°', () => {
    const nautical = events.filter((e) => e.kind !== EventKind.AstroDusk && e.kind !== EventKind.AstroDawn);
    const night = nightWindow(nautical, now);
    expect(night.kind).toBe(NightKind.Nautical);
    expect(night.startMs).toBeLessThan(nightWindow(events, now).startMs);
  });

  it('calls a sun that never clears astronomical night dark all day', () => {
    const up = { ...ev(SkyBody.Sun, EventKind.Transit, start), altitude: 12 };
    expect(nightWindow([up], now).kind).toBe(NightKind.None);
    const sunk = { ...ev(SkyBody.Sun, EventKind.Transit, start), altitude: -21 };
    expect(nightWindow([sunk], now).kind).toBe(NightKind.AllDark);
  });
});

describe('moonFreeWindow', () => {
  const night = nightWindow(events, now);

  it('is empty when the moon is up all night', () => {
    // The near-full moon rises before dusk and sets after dawn.
    expect(SearchRiseSet(Body.Moon, hoboken, 1, new Date(start), 1)!.date.getTime()).toBeLessThan(night.startMs);
    expect(SearchRiseSet(Body.Moon, hoboken, -1, new Date(start), 1)!.date.getTime()).toBeGreaterThan(night.endMs);
    expect(moonAlt(night.startMs)).toBeGreaterThan(0);
    expect(moonFreeWindow(night, events, moonAlt(night.startMs) > 0)).toBeNull();
  });

  it('is the whole night when the moon never rises', () => {
    expect(moonFreeWindow(night, [], false)).toEqual({ startMs: night.startMs, endMs: night.endMs });
  });

  it('ends at moonrise and stays inside the night', () => {
    const rise = night.startMs + 2 * 3_600_000;
    const gap = moonFreeWindow(night, [ev(SkyBody.Moon, EventKind.Rise, rise)], false)!;
    expect(gap).toEqual({ startMs: night.startMs, endMs: rise });
    expect(gap.startMs).toBeGreaterThanOrEqual(night.startMs);
    expect(gap.endMs).toBeLessThanOrEqual(night.endMs);
  });

  it('keeps the longest gap when the moon rises and sets twice', () => {
    const h = 3_600_000;
    const moon = [
      ev(SkyBody.Moon, EventKind.Rise, night.startMs + h),
      ev(SkyBody.Moon, EventKind.Set, night.startMs + 2 * h),
      ev(SkyBody.Moon, EventKind.Rise, night.endMs - h)
    ];
    expect(moonFreeWindow(night, moon, false)).toEqual({ startMs: night.startMs + 2 * h, endMs: night.endMs - h });
  });

  it('has no window without a night', () => {
    const none: NightWindow = { startMs: 0, endMs: 0, kind: NightKind.None };
    expect(moonFreeWindow(none, events, false)).toBeNull();
  });
});

describe('nextMoonEvent', () => {
  it('is the moonset after the simulated time', () => {
    const set = SearchRiseSet(Body.Moon, hoboken, -1, new Date(start), 1)!;
    const next = nextMoonEvent(events, now)!;
    expect(next.kind).toBe(EventKind.Set);
    expect(Math.abs(next.time - set.date.getTime())).toBeLessThanOrEqual(60_000);
  });

  it('is null past the last crossing', () => {
    expect(nextMoonEvent(events, end)).toBeNull();
  });
});
