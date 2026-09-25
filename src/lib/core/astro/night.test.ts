import { Body, Equator, Horizon, SearchAltitude, SearchRiseSet } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { makeObserver, SkyBody } from './bodies';
import { dayEvents, EventKind, type DayEvent } from './dayEvents';
import { lunarShadowCoverage, lunarTotality } from './eclipse';
import { moonFreeWindow, nextMoonEvent, nightWindow, NightKind, panelNight, type NightWindow } from './night';

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
    expect(moonFreeWindow(night, [], false)).toEqual({ startMs: night.startMs, endMs: night.endMs, eclipsed: false });
  });

  it('ends at moonrise and stays inside the night', () => {
    const rise = night.startMs + 2 * 3_600_000;
    const gap = moonFreeWindow(night, [ev(SkyBody.Moon, EventKind.Rise, rise)], false)!;
    expect(gap).toEqual({ startMs: night.startMs, endMs: rise, eclipsed: false });
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
    expect(moonFreeWindow(night, moon, false)).toEqual({ startMs: night.startMs + 2 * h, endMs: night.endMs - h, eclipsed: false });
  });

  it('has no window without a night', () => {
    const none: NightWindow = { startMs: 0, endMs: 0, kind: NightKind.None };
    expect(moonFreeWindow(none, events, false)).toBeNull();
  });
});

describe('moonFreeWindow through a total lunar eclipse', () => {
  // 2025-09-07 from New Delhi: the full moon is up all night; totality 17:31–18:53 UTC (NASA).
  const delhi = makeObserver({ lat: 28.61, lng: 77.21 });
  const dEvents = dayEvents(delhi, Date.UTC(2025, 8, 7, 6, 30), Date.UTC(2025, 8, 8, 6, 30));
  const dNight = nightWindow(dEvents, Date.UTC(2025, 8, 7, 12));
  const totality = lunarTotality(dNight.startMs, dNight.endMs)!;
  const upAtStart = true;
  const night = nightWindow(events, now);

  it('finds totality where the whole disc is in the umbra', () => {
    expect(Math.abs(totality.startMs - Date.parse('2025-09-07T17:30:41Z'))).toBeLessThan(10_000);
    expect(Math.abs(totality.endMs - Date.parse('2025-09-07T18:52:47Z'))).toBeLessThan(10_000);
    expect(lunarShadowCoverage(new Date(totality.startMs + 1_000)).umbra).toBe(1);
    expect(lunarShadowCoverage(new Date(totality.startMs - 1_000)).umbra).toBeLessThan(1);
    expect(lunarShadowCoverage(new Date(totality.endMs - 1_000)).umbra).toBe(1);
    expect(lunarShadowCoverage(new Date(totality.endMs + 1_000)).umbra).toBeLessThan(1);
  });

  it('opens a window for totality alone when the moon is up all night', () => {
    expect(moonFreeWindow(dNight, dEvents, upAtStart)).toBeNull();
    expect(moonFreeWindow(dNight, dEvents, upAtStart, totality)).toEqual({ ...totality, eclipsed: true });
  });

  it('grows a moon-down window by the totality next to it', () => {
    const h = 3_600_000;
    const rise = ev(SkyBody.Moon, EventKind.Rise, night.startMs + 2 * h);
    const w = moonFreeWindow(night, [rise], false, { startMs: night.startMs + 2 * h, endMs: night.startMs + 3 * h });
    expect(w).toEqual({ startMs: night.startMs, endMs: night.startMs + 3 * h, eclipsed: true });
  });

  it('is unchanged by a totality with the moon already down', () => {
    const h = 3_600_000;
    const set = ev(SkyBody.Moon, EventKind.Set, night.startMs + h);
    expect(moonFreeWindow(night, [set], true, { startMs: night.startMs + 2 * h, endMs: night.startMs + 3 * h })).toEqual({ startMs: night.startMs + h, endMs: night.endMs, eclipsed: false });
  });

  it('leaves a night without an eclipse as it was', () => {
    expect(lunarTotality(night.startMs, night.endMs)).toBeNull();
    const up = moonAlt(night.startMs) > 0;
    expect(moonFreeWindow(night, events, up, null)).toEqual(moonFreeWindow(night, events, up));
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

describe('panelNight', () => {
  const tz = 'America/New_York';
  const H = 3_600_000;
  const sun = (kind: EventKind, time: number): DayEvent => ({ body: SkyBody.Sun, kind, time, azimuth: 0, altitude: 0 });
  // Each noon (EDT) → noon window: astro dusk 19:40, astro dawn 05:10, sunrise 06:40 local.
  const fake = (rise: boolean) => (startMs: number) => [
    sun(EventKind.AstroDusk, startMs + 7.67 * H),
    sun(EventKind.AstroDawn, startMs + 17.17 * H),
    ...(rise ? [sun(EventKind.Rise, startMs + 18.67 * H)] : [])
  ];
  const tonight = Date.UTC(2026, 9, 26, 16);
  const tomorrow = Date.UTC(2026, 9, 27, 16);
  const at = (iso: string, rise = true) => panelNight(new Date(iso), tz, fake(rise)).startMs;

  it('shows the night running at 11 PM and 2 AM', () => {
    expect(at('2026-10-27T03:00:00Z')).toBe(tonight);
    expect(at('2026-10-27T06:00:00Z')).toBe(tonight);
  });

  it('moves on to the coming night after sunrise: 7 AM and 9 AM', () => {
    expect(at('2026-10-27T11:00:00Z')).toBe(tomorrow);
    expect(at('2026-10-27T13:00:00Z')).toBe(tomorrow);
    expect(panelNight(new Date('2026-10-27T13:00:00Z'), tz, fake(true)).events[0].time).toBe(tomorrow + 7.67 * H);
  });

  it('falls back to dawn without a sunrise', () => {
    expect(at('2026-10-27T10:00:00Z', false)).toBe(tomorrow);
    expect(at('2026-10-27T08:00:00Z', false)).toBe(tonight);
  });
});
