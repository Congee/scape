import { describe, expect, it } from 'vitest';
import type { HorizonProfile } from '@core/terrain/horizon';
import { dayBounds } from '@core/time/localDay';
import { BODIES, makeObserver, SkyBody } from './bodies';
import { dayCurve } from './dayCurve';
import { dayEvents, EventKind } from './dayEvents';
import { distinctTerrainEvents, terrainRiseSet } from './terrainEvents';

const obs = makeObserver({ lat: 40.7463, lng: -74.1553 });
const day = dayBounds(new Date(Date.UTC(2026, 8, 11, 16)), 'America/New_York');
const start = day.start.getTime();
const end = day.end.getTime();
const curve = dayCurve(obs, start, end);
const events = dayEvents(obs, start, end);
const flat = (deg: number): HorizonProfile => ({ azStepDeg: 1, angleDeg: new Float32Array(360).fill(deg), distM: new Float32Array(360), rangeM: 1e5 });
const find = (list: typeof events, body: SkyBody, kind: EventKind) => list.find((e) => e.body === body && e.kind === kind)!;

describe('terrainRiseSet', () => {
  it('matches the standard rise and set over a flat horizon', () => {
    const t = terrainRiseSet(obs, curve, flat(0), end);
    for (const body of BODIES) {
      expect(Math.abs(find(t, body, EventKind.TerrainRise).time - find(events, body, EventKind.Rise).time)).toBeLessThan(60_000);
      expect(Math.abs(find(t, body, EventKind.TerrainSet).time - find(events, body, EventKind.Set).time)).toBeLessThan(60_000);
    }
    expect(distinctTerrainEvents(t, events)).toHaveLength(0);
  });

  it('delays the rise and advances the set behind a 5° wall', () => {
    const t = terrainRiseSet(obs, curve, flat(5), end);
    const rise = find(t, SkyBody.Sun, EventKind.TerrainRise);
    const set = find(t, SkyBody.Sun, EventKind.TerrainSet);
    const lateBy = rise.time - find(events, SkyBody.Sun, EventKind.Rise).time;
    const earlyBy = find(events, SkyBody.Sun, EventKind.Set).time - set.time;
    expect(lateBy).toBeGreaterThan(20 * 60_000);
    expect(lateBy).toBeLessThan(90 * 60_000);
    expect(earlyBy).toBeGreaterThan(20 * 60_000);
    expect(rise.altitude).toBeCloseTo(5 - 0.2667, 1);
    expect(set.altitude).toBeCloseTo(5 - 0.2667, 1);
    expect(distinctTerrainEvents(t, events).filter((e) => e.body === SkyBody.Sun)).toHaveLength(2);
  });
});
