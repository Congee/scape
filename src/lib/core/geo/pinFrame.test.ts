import { describe, expect, it } from 'vitest';
import { mPerDegLng, M_PER_DEG, pinFrameLat } from './pinFrame';

/** Maps (e, n) to lng/lat the way the ceiling grids are filled. */
function forward(pin: { lng: number; lat: number }, e: number, n: number): { lng: number; lat: number } {
  const lat = pinFrameLat(pin.lat, n);
  return { lng: pin.lng + e / mPerDegLng(lat), lat };
}

/** Maps lng/lat back the way building footprints are stamped. */
function back(pin: { lng: number; lat: number }, lng: number, lat: number): { e: number; n: number } {
  return { e: (lng - pin.lng) * mPerDegLng(lat), n: (lat - pin.lat) * M_PER_DEG };
}

describe('pin frame', () => {
  it('round-trips the forward and inverse maps', () => {
    const pin = { lng: -73.9857, lat: 40.7484 };
    for (const [e, n] of [
      [0, 0],
      [2500, 2500],
      [-9000, 4000],
      [40_000, -40_000]
    ]) {
      const p = forward(pin, e, n);
      const r = back(pin, p.lng, p.lat);
      expect(r.e).toBeCloseTo(e, 6);
      expect(r.n).toBeCloseTo(n, 6);
    }
  });

  it('shrinks the longitude scale with latitude', () => {
    expect(mPerDegLng(0)).toBeCloseTo(M_PER_DEG, 6);
    expect(mPerDegLng(60)).toBeCloseTo(M_PER_DEG / 2, 3);
  });

  it('moves one degree of latitude per M_PER_DEG metres north', () => {
    expect(pinFrameLat(10, M_PER_DEG)).toBeCloseTo(11, 9);
  });
});
