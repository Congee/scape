import { describe, expect, it } from 'vitest';
import { makeObserver, SkyBody } from './bodies';
import { position } from './positions';
import { apparentAltitude, HORIZON_ALT_DEG, TAPER_END_DEG } from './refraction';

describe('apparentAltitude', () => {
  it('leaves altitudes below the taper geometric', () => {
    expect(apparentAltitude(-12)).toBe(-12);
    expect(apparentAltitude(TAPER_END_DEG)).toBe(TAPER_END_DEG);
  });

  it('refracts a body that is up', () => {
    expect(apparentAltitude(10)).toBeCloseTo(10.09, 2);
  });

  // JPL Horizons, Sun from New York 2026-10-26 21:40–22:04 UTC: airless → refracted.
  it.each([
    [2.755577552, 2.994816082],
    [1.319037448, 1.65222136],
    [0.596679122, 1.002051512],
    [-0.128261739, 0.373838897],
    [-0.855680078, -0.233574942],
  ])('matches Horizons refraction at %f°', (geom, app) => {
    expect(Math.abs(apparentAltitude(geom) - app)).toBeLessThan(0.0005);
  });

  it('is continuous and monotone through the horizon', () => {
    let prev = apparentAltitude(-5.001);
    for (let g = -5; g <= 5; g += 0.001) {
      const a = apparentAltitude(g);
      expect(a).toBeGreaterThan(prev);
      expect(a - prev).toBeLessThan(0.002);
      prev = a;
    }
  });

  it('has no step at the rise/set threshold', () => {
    expect(apparentAltitude(HORIZON_ALT_DEG) - apparentAltitude(HORIZON_ALT_DEG - 1e-4)).toBeLessThan(1e-3);
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
