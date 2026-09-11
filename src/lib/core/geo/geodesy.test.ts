import { describe, expect, it } from 'vitest';
import { bearingDeg, destination, distanceM, elevationAngleDeg, geodesicRay } from './geodesy';

const nyc = { lng: -74.006, lat: 40.7128 };
const london = { lng: -0.1276, lat: 51.5072 };

describe('geodesy', () => {
  it('measures NYC to London', () => {
    expect(distanceM(nyc, london) / 1000).toBeCloseTo(5570, -1);
    expect(bearingDeg(nyc, london)).toBeCloseTo(51.2, 0);
  });

  it('round-trips destination and bearing', () => {
    const p = destination(nyc, 83.4, 100_000);
    expect(distanceM(nyc, p)).toBeCloseTo(100_000, -1);
    expect(bearingDeg(nyc, p)).toBeCloseTo(83.4, 1);
  });

  it('keeps rays continuous across the antimeridian', () => {
    const ray = geodesicRay({ lng: 179.5, lat: 0 }, 90, 200_000, 8);
    for (let i = 1; i < ray.length; i++) expect(Math.abs(ray[i][0] - ray[i - 1][0])).toBeLessThan(2);
    expect(ray.at(-1)![0]).toBeGreaterThan(180);
  });

  it('computes an elevation angle with Earth curvature', () => {
    expect(elevationAngleDeg(1000, 100)).toBeCloseTo(5.71, 1);
    expect(elevationAngleDeg(50_000, 0)).toBeLessThan(0);
  });
});
