import { describe, expect, it } from 'vitest';
import { dayBounds } from '@core/time/localDay';
import { makeObserver, SkyBody } from './bodies';
import { dayCurve } from './dayCurve';
import { dayEvents, EventKind } from './dayEvents';

// Ground truth captured from TPE Web for 40.7463N 74.1553W on 2026-09-11 (EDT).
const obs = makeObserver({ lat: 40.7463, lng: -74.1553 });
const tz = 'America/New_York';
const day = dayBounds(new Date(Date.UTC(2026, 8, 11, 16)), tz);
const edt = (h: number, m: number) => Date.UTC(2026, 8, 11, h + 4, m);

describe('dayEvents', () => {
  const events = dayEvents(obs, day.start.getTime(), day.end.getTime());
  const find = (body: SkyBody, kind: EventKind) => events.find((e) => e.body === body && e.kind === kind)!;

  it.each([
    [SkyBody.Sun, EventKind.AstroDawn, edt(4, 59), 67.14],
    [SkyBody.Sun, EventKind.NauticalDawn, edt(5, 33), 73.23],
    [SkyBody.Sun, EventKind.CivilDawn, edt(6, 5), 78.81],
    [SkyBody.Sun, EventKind.Rise, edt(6, 33), 83.38],
    [SkyBody.Sun, EventKind.GoldenEnd, edt(7, 9), 89.28],
    [SkyBody.Sun, EventKind.Transit, edt(12, 53), 180.0],
    [SkyBody.Sun, EventKind.GoldenStart, edt(18, 36), 270.48],
    [SkyBody.Sun, EventKind.Set, edt(19, 12), 276.36],
    [SkyBody.Sun, EventKind.CivilDusk, edt(19, 39), 280.9],
    [SkyBody.Sun, EventKind.NauticalDusk, edt(20, 12), 286.44],
    [SkyBody.Sun, EventKind.AstroDusk, edt(20, 45), 292.49],
    [SkyBody.Moon, EventKind.Rise, edt(7, 2), 88.81],
    [SkyBody.Moon, EventKind.Transit, edt(13, 16), 180.04],
    [SkyBody.Moon, EventKind.Set, edt(19, 18), 266.89]
  ])('%s %s matches TPE', (body, kind, time, az) => {
    const ev = find(body, kind);
    expect(ev).toBeDefined();
    expect(Math.abs(ev.time - time)).toBeLessThanOrEqual(60_000);
    expect(ev.azimuth).toBeCloseTo(az, 0);
  });

  it('reports a thin waxing crescent at moonrise', () => {
    const m = find(SkyBody.Moon, EventKind.Rise).moon!;
    expect(m.waxing).toBe(true);
    expect(m.illumination).toBeLessThan(0.01);
  });

  it('is sorted and stays inside the local day', () => {
    for (let i = 1; i < events.length; i++) expect(events[i].time).toBeGreaterThanOrEqual(events[i - 1].time);
    for (const e of events) {
      expect(e.time).toBeGreaterThanOrEqual(day.start.getTime());
      expect(e.time).toBeLessThan(day.end.getTime());
    }
  });
});

describe('dayCurve', () => {
  it('samples the day and crosses zero near sunrise', () => {
    const c = dayCurve(obs, day.start.getTime(), day.end.getTime(), 60_000);
    expect(c.n).toBe(1441);
    const i = Math.round((edt(6, 33) - c.startMs) / c.stepMs);
    // Apparent (refracted) centre altitude at upper-limb rise is about -0.27 degrees.
    expect(c.altitude.Sun[i]).toBeGreaterThan(-0.6);
    expect(c.altitude.Sun[i]).toBeLessThan(0);
    expect(c.altitude.Sun[i + 60]).toBeGreaterThan(c.altitude.Sun[i]);
  });
});
