import { describe, expect, it } from 'vitest';
import { bearingDeg, destination, distanceM, elevationAngleDeg, geodesicRay, heightAtAngle } from './geodesy';

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

  it('inverts the elevation angle back to a height', () => {
    for (const [d, h] of [[1000, 1400], [42_000, 120], [250, -30]]) {
      expect(heightAtAngle(90, d, elevationAngleDeg(d, h - 90))).toBeCloseTo(h, 6);
    }
  });
});

// WGS84 geodesics from GeographicLib (Karney): [from lat, lng, azimuth, metres, to lat, lng].
describe('spherical accuracy vs WGS84', () => {
  it.each([
    [0, 7, 45, 1000, 0.006394858, 7.006352048],
    [46, 7, 45, 50000, 46.317155879, 7.459044102],
    [69.65, 18.96, 135, 20000, 69.522853766, 19.322080181],
    [-45, 168.66, 300, 100000, -44.544838741, 167.570208063]
  ])('%f,%f az %f %f m: distance within 0.6%, bearing within 0.2°', (lat, lng, az, s, lat2, lng2) => {
    const a = { lat, lng };
    const b = { lat: lat2, lng: lng2 };
    expect(Math.abs(distanceM(a, b) - s) / s).toBeLessThan(0.006);
    expect(Math.abs(((bearingDeg(a, b) - az + 540) % 360) - 180)).toBeLessThan(0.2);
  });
});
