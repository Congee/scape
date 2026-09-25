import { describe, expect, it } from 'vitest';
import type { HorizonProfile } from '@core/terrain/horizon';
import { dayBounds } from '@core/time/localDay';
import { makeObserver, SkyBody } from './bodies';
import { dayCurve } from './dayCurve';
import { dayEvents, EventKind } from './dayEvents';
import { firstLastLight, lightAt, LightMode, pickLight, sunLitAt } from './lightSource';

const profile = (f: (az: number) => number): HorizonProfile => ({
  azStepDeg: 1,
  angleDeg: Float32Array.from({ length: 360 }, (_, i) => f(i)),
  distM: new Float32Array(360),
  rangeM: 1e5
});

describe('pickLight', () => {
  it('follows the sun by day and the moon once dusk is over', () => {
    expect(pickLight(LightMode.Auto, 10, 30)).toBe(SkyBody.Sun);
    expect(pickLight(LightMode.Auto, -3, 30)).toBeNull();
    expect(pickLight(LightMode.Auto, -8, 30)).toBe(SkyBody.Moon);
    expect(pickLight(LightMode.Auto, -8, -2)).toBeNull();
  });

  it('holds the chosen body while it is up', () => {
    expect(pickLight(LightMode.Moon, 20, 15)).toBe(SkyBody.Moon);
    expect(pickLight(LightMode.Moon, 20, -1)).toBeNull();
    expect(pickLight(LightMode.Sun, -8, 30)).toBeNull();
    expect(pickLight(LightMode.Sun, 5, 30)).toBe(SkyBody.Sun);
  });
});

describe('lightAt', () => {
  it('drops the moon as a light at totality (2025-09-07, Delhi)', () => {
    const obs = makeObserver({ lat: 28.6, lng: 77.2 });
    expect(lightAt(LightMode.Moon, new Date('2025-09-07T15:00:00Z'), obs)?.body).toBe(SkyBody.Moon);
    expect(lightAt(LightMode.Moon, new Date('2025-09-07T18:11:43Z'), obs)).toBeNull();
  });
});

describe('firstLastLight', () => {
  // Zermatt, 2026-12-21: a deep valley in midwinter.
  const obs = makeObserver({ lat: 46.0207, lng: 7.7491 }, 1608);
  const day = dayBounds(new Date(Date.UTC(2026, 11, 21, 11)), 'Europe/Zurich');
  const start = day.start.getTime();
  const end = day.end.getTime();
  const curve = dayCurve(obs, start, end);
  const events = dayEvents(obs, start, end);
  const find = (kind: EventKind) => events.find((e) => e.body === SkyBody.Sun && e.kind === kind)!.time;

  it('equals sunrise and sunset over a flat horizon', () => {
    const l = firstLastLight(obs, curve, profile(() => 0), end, find(EventKind.Rise) + 3_600_000);
    expect(Math.abs(l.first! - find(EventKind.Rise))).toBeLessThan(60_000);
    expect(Math.abs(l.last! - find(EventKind.Set))).toBeLessThan(60_000);
    expect(Math.abs(l.litMs - (l.last! - l.first!))).toBeLessThan(1000);
    expect(l.litNow).toBe(true);
  });

  it('comes later and ends sooner behind valley walls, and adds up broken sunshine', () => {
    // Walls east and west, and a peak due south that hides the noon sun.
    const l = firstLastLight(obs, curve, profile((az) => (az > 170 && az < 190 ? 25 : 10)), end, Date.UTC(2026, 11, 21, 11, 15));
    expect(l.first! - find(EventKind.Rise)).toBeGreaterThan(30 * 60_000);
    expect(find(EventKind.Set) - l.last!).toBeGreaterThan(30 * 60_000);
    expect(l.litMs).toBeLessThan(l.last! - l.first! - 30 * 60_000);
    expect(l.litNow).toBe(false);
  });

  it('reports no light at all when the skyline stands above the winter sun', () => {
    const l = firstLastLight(obs, curve, profile(() => 30), end, start);
    expect(l.first).toBeNull();
    expect(l.last).toBeNull();
    expect(l.litMs).toBe(0);
  });
});

describe('sunLitAt', () => {
  it('puts a noon sun in shade behind a wall to the south only', () => {
    const obs = makeObserver({ lat: 46, lng: 7.75 });
    const noon = Date.parse('2026-10-18T11:10Z');
    expect(sunLitAt(obs, profile(() => 0), noon)).toBe(true);
    expect(sunLitAt(obs, profile((az) => (az > 150 && az < 210 ? 45 : 0)), noon)).toBe(false);
    expect(sunLitAt(obs, profile((az) => (az < 30 || az > 330 ? 45 : 0)), noon)).toBe(true);
  });
});
