import { describe, expect, it } from 'vitest';
import { bearingDeg, destination, distanceM, inverse, normalizeBearing } from './geodesy';
import { frameAt, pinFrame } from './pinFrame';

const R2D = 180 / Math.PI;

describe('pin frame', () => {
  // East and north from a textbook WGS84 geodetic → ECEF → ENU rotation, computed independently.
  it('matches the ECEF/ENU rotation', () => {
    for (const [pin, p, e, n] of [
      [{ lng: 7, lat: 46 }, { lng: 7.3, lat: 46.2 }, 23155.012229, 22274.215498],
      [{ lng: -74, lat: 40.75 }, { lng: -73.9, lat: 40.7 }, 8451.546483, -5547.614761],
      [{ lng: 18.96, lat: 69.65 }, { lng: 19.5, lat: 69.4 }, 21212.079763, -27795.180067],
      [{ lng: 168.66, lat: -45 }, { lng: 167.9, lat: -44.6 }, -60337.292527, 44167.818062],
      [{ lng: 179.9, lat: 10 }, { lng: -179.8, lat: 10.1 }, 32881.552502, 11075.75247]
    ] as const) {
      const [pe, pn] = pinFrame(pin).toEn(p.lng, p.lat);
      expect(Math.abs(pe - e)).toBeLessThan(1e-5);
      expect(Math.abs(pn - n)).toBeLessThan(1e-5);
    }
  });

  it('round-trips fromEn and toEn', () => {
    for (const pin of [
      { lng: -73.9857, lat: 40.7484 },
      { lng: 179.99, lat: -12 },
      { lng: 10, lat: 89.9 },
      { lng: 0, lat: 0 }
    ]) {
      const f = pinFrame(pin);
      for (const [e, n] of [
        [0, 0],
        [0.5, -0.25],
        [2500, 2500],
        [-9000, 4000],
        [40_000, -40_000],
        [-150_000, 90_000]
      ]) {
        const p = f.fromEn(e, n);
        const [re, rn] = f.toEn(p.lng, p.lat);
        expect(Math.abs(re - e)).toBeLessThan(1e-6);
        expect(Math.abs(rn - n)).toBeLessThan(1e-6);
        expect(p.lng).toBeGreaterThanOrEqual(-180);
        expect(p.lng).toBeLessThan(180);
      }
    }
  });

  // The frame's azimuth is the geodesic bearing to well inside the viewfinder's reach.
  it('agrees with the geodesic bearing and distance', () => {
    const pin = { lng: 7.66, lat: 45.98 };
    const f = pinFrame(pin);
    for (let az = 5; az < 360; az += 40) {
      for (const [d, azTol, dTol] of [
        [1000, 1e-9, 1e-4],
        [50_000, 3e-6, 1],
        [200_000, 4e-5, 40]
      ]) {
        const q = destination(pin, az, d);
        const [e, n] = f.toEn(q.lng, q.lat);
        const enAz = (Math.atan2(e, n) * R2D + 360) % 360;
        expect(Math.abs(enAz - bearingDeg(pin, q))).toBeLessThan(azTol);
        expect(Math.abs(Math.hypot(e, n) - distanceM(pin, q))).toBeLessThan(dTol);
        expect(Math.abs(normalizeBearing(inverse(pin, q).azi1) - az)).toBeLessThan(1e-9);
      }
    }
  });

  it('memoises on the pin value', () => {
    const a = frameAt({ lng: 1, lat: 2 });
    expect(frameAt({ lng: 1, lat: 2 })).toBe(a);
    expect(frameAt({ lng: 1, lat: 2.5 })).not.toBe(a);
  });
});
