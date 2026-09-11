import { describe, expect, it } from 'vitest';
import type { HorizonProfile } from '@core/terrain/horizon';
import { dayBounds } from '@core/time/localDay';
import { makeObserver } from './bodies';
import { dayCurve } from './dayCurve';
import { dayEvents } from './dayEvents';
import { distinctTerrainEvents, terrainRiseSet } from './terrainEvents';

const obs = makeObserver({ lat: 40.7463, lng: -74.1553 });
const day = dayBounds(new Date(Date.UTC(2026, 8, 11, 16)), 'America/New_York');
const start = day.start.getTime();
const end = day.end.getTime();
const curve = dayCurve(obs, start, end);
const events = dayEvents(obs, start, end);
const flat = (deg: number): HorizonProfile => ({ azStepDeg: 1, angleDeg: new Float32Array(360).fill(deg), distM: new Float32Array(360), rangeM: 1e5 });
const find = (list: typeof events, body: string, kind: string) => list.find((e) => e.body === body && e.kind === kind)!;

describe('terrainRiseSet', () => {
  it('matches the standard rise and set over a flat horizon', () => {
    const t = terrainRiseSet(obs, curve, flat(0), end);
    for (const body of ['sun', 'moon', 'gc'] as const) {
      expect(Math.abs(find(t, body, 'terrainRise').time - find(events, body, 'rise').time)).toBeLessThan(60_000);
      expect(Math.abs(find(t, body, 'terrainSet').time - find(events, body, 'set').time)).toBeLessThan(60_000);
    }
    expect(distinctTerrainEvents(t, events)).toHaveLength(0);
  });

  it('delays the rise and advances the set behind a 5° wall', () => {
    const t = terrainRiseSet(obs, curve, flat(5), end);
    const rise = find(t, 'sun', 'terrainRise');
    const set = find(t, 'sun', 'terrainSet');
    const lateBy = rise.time - find(events, 'sun', 'rise').time;
    const earlyBy = find(events, 'sun', 'set').time - set.time;
    expect(lateBy).toBeGreaterThan(20 * 60_000);
    expect(lateBy).toBeLessThan(90 * 60_000);
    expect(earlyBy).toBeGreaterThan(20 * 60_000);
    expect(rise.altitude).toBeCloseTo(5 - 0.2667, 1);
    expect(set.altitude).toBeCloseTo(5 - 0.2667, 1);
    expect(distinctTerrainEvents(t, events).filter((e) => e.body === 'sun')).toHaveLength(2);
  });
});
