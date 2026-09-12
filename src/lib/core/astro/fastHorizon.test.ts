import { describe, expect, it } from 'vitest';
import { makeObserver } from './bodies';
import { horizontalFast, separationDeg, skySample } from './fastHorizon';
import { position } from './positions';

const ref = makeObserver({ lat: 46.0207, lng: 7.7491 });
const times = ['2026-09-11T05:30:00Z', '2026-09-11T17:00:00Z', '2026-12-21T12:00:00Z'].map((s) => Date.parse(s));
const spots = [
  { lat: 46.0207, lng: 7.7491 },
  { lat: 46.5, lng: 8.4 },
  { lat: 45.6, lng: 7.1 }
];

describe('fast horizontal coordinates', () => {
  it('agrees with the full ephemeris within 0.02° up to 60 km from the reference', () => {
    for (const body of ['Sun', 'Moon', 'Gc'] as const) {
      for (const ms of times) {
        const s = skySample(body, ms, ref);
        for (const p of spots) {
          const exact = position(body, new Date(ms), makeObserver(p));
          const fast = horizontalFast(s, p.lat, p.lng);
          expect(separationDeg(fast.azimuth, fast.altitude, exact.azimuth, exact.altitude)).toBeLessThan(body === 'Moon' ? 0.02 : 0.003);
        }
      }
    }
  });

  it('measures separations on the sky sphere', () => {
    expect(separationDeg(0, 0, 90, 0)).toBeCloseTo(90);
    expect(separationDeg(10, 80, 190, 80)).toBeCloseTo(20);
    expect(separationDeg(45, 10, 45, 12)).toBeCloseTo(2);
  });
});
