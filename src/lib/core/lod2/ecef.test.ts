import { describe, expect, it } from 'vitest';
import { ecefToGeodetic, geodeticToEcef } from './ecef';

describe('ecef', () => {
  it('puts the equator and prime meridian on the x axis', () => {
    const [x, y, z] = geodeticToEcef(0, 0, 0);
    expect(x).toBe(6378137);
    expect(y).toBe(0);
    expect(z).toBe(0);
  });

  it('round-trips to well under a millimetre', () => {
    for (const [lng, lat, h] of [
      [4.4868, 51.9091, 43.6],
      [8.54, 47.37, 600],
      [139.76, 35.68, 3000],
      [-70, -89.9, 10],
      [170, 89.99, -50]
    ]) {
      const g = ecefToGeodetic(...geodeticToEcef(lng, lat, h));
      expect(Math.abs(g.lng - lng) * 111e3).toBeLessThan(1e-4);
      expect(Math.abs(g.lat - lat) * 111e3).toBeLessThan(1e-4);
      expect(Math.abs(g.h - h)).toBeLessThan(1e-4);
    }
  });
});
