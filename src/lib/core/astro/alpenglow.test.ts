import { describe, expect, it } from 'vitest';
import type { HorizonProfile } from '@core/terrain/horizon';
import { dayBounds } from '@core/time/localDay';
import { glowDay, GlowKind } from './alpenglow';
import { makeObserver, SkyBody } from './bodies';
import { dayEvents, EventKind } from './dayEvents';
import { position } from './positions';

const profile = (f: (az: number) => number): HorizonProfile => ({
  azStepDeg: 1,
  angleDeg: Float32Array.from({ length: 360 }, (_, i) => f(i)),
  distM: new Float32Array(360),
  rangeM: 1e5
});

// Chamonix, 2026-09-26.
const obs = makeObserver({ lat: 45.9237, lng: 6.8694 }, 1035);
const day = dayBounds(new Date(Date.UTC(2026, 8, 26, 11)), 'Europe/Paris');
const start = day.start.getTime();
const end = day.end.getTime();
const events = dayEvents(obs, start, end);
const find = (kind: EventKind) => events.find((e) => e.body === SkyBody.Sun && e.kind === kind)!.time;
const altAt = (ms: number) => position(SkyBody.Sun, new Date(ms), obs).altitude;

describe('glowDay', () => {
  it('runs from sunrise to the low limit and back to sunset over a flat skyline', () => {
    const g = glowDay(obs, profile(() => 0), start, end, 6);
    expect(g.sunrise!.kind).toBe(GlowKind.Sunrise);
    expect(Math.abs(g.sunrise!.startMs - find(EventKind.Rise))).toBeLessThan(60_000);
    expect(altAt(g.sunrise!.endMs)).toBeCloseTo(6, 2);
    expect(altAt(g.sunset!.startMs)).toBeCloseTo(6, 2);
    expect(Math.abs(g.sunset!.endMs - find(EventKind.Set))).toBeLessThan(60_000);
    expect(g.sunrise!.azimuthDeg).toBeLessThan(180);
    expect(g.sunset!.azimuthDeg).toBeGreaterThan(180);
    expect(g.sunset!.altitudeDeg).toBeGreaterThan(0);
    expect(g.sunset!.altitudeDeg).toBeLessThan(6);
  });

  it('has no morning window when the east wall hides the Sun until it is high', () => {
    const g = glowDay(obs, profile((az) => (az < 180 ? 10 : 0)), start, end, 6);
    expect(g.sunrise).toBeNull();
    expect(g.sunset).not.toBeNull();
  });

  it('ends the evening window where the west skyline takes the Sun', () => {
    const g = glowDay(obs, profile((az) => (az >= 180 ? 3 : 0)), start, end, 6);
    const flat = glowDay(obs, profile(() => 0), start, end, 6);
    expect(g.sunset!.endMs).toBeLessThan(flat.sunset!.endMs - 10 * 60_000);
    expect(altAt(g.sunset!.endMs)).toBeGreaterThan(2);
  });

  it('widens with the low limit', () => {
    const a = glowDay(obs, profile(() => 0), start, end, 3);
    const b = glowDay(obs, profile(() => 0), start, end, 10);
    expect(b.sunrise!.endMs - b.sunrise!.startMs).toBeGreaterThan(a.sunrise!.endMs - a.sunrise!.startMs);
  });
});
