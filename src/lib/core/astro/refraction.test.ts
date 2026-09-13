import { describe, expect, it } from 'vitest';
import { makeObserver, SkyBody } from './bodies';
import { position } from './positions';
import { apparentAltitude, HORIZON_ALT_DEG } from './refraction';

describe('apparentAltitude', () => {
  it('leaves altitudes below the horizon geometric', () => {
    expect(apparentAltitude(-12)).toBe(-12);
  });

  it('refracts a body that is up', () => {
    expect(apparentAltitude(10)).toBeCloseTo(10.09, 2);
  });

  it('steps up at the rise/set threshold without overshooting', () => {
    expect(apparentAltitude(HORIZON_ALT_DEG)).toBeGreaterThan(apparentAltitude(-0.8334));
  });
});

describe('position', () => {
  const obs = makeObserver({ lat: 40.747952, lng: -74.023685 }, 3);
  const t = new Date('2026-10-26T23:01:25Z');

  it('reports the sun below the horizon geometrically', () => {
    const p = position(SkyBody.Sun, t, obs);
    expect(Math.abs(p.altitude + 12.26)).toBeLessThan(0.03);
    expect(Math.abs(p.azimuth - 263.71)).toBeLessThan(0.02);
  });

  it('reports the moon above the horizon refracted', () => {
    const p = position(SkyBody.Moon, t, obs);
    expect(Math.abs(p.altitude - 9.99)).toBeLessThan(0.03);
    expect(Math.abs(p.azimuth - 71.9)).toBeLessThan(0.02);
  });
});
