import { describe, expect, it } from 'vitest';
import { distanceM, bearingDeg } from '@core/geo/geodesy';
import { CLOUD_HEIGHT_M, reachM, SIGHT_KM, sightPoints, SightVerdict, summarise, type SightSample } from './sightline';

const rotterdam = { lat: 51.9225, lng: 4.4792 };
const flat = (low: number, mid: number, high = 50): SightSample[] => SIGHT_KM.map((km) => ({ km, low, mid, high }));

describe('sightline geometry', () => {
  it('reaches ~113 km for low and ~319 km for high cloud', () => {
    expect(reachM(CLOUD_HEIGHT_M.low) / 1000).toBeCloseTo(112.9, 0);
    expect(reachM(CLOUD_HEIGHT_M.high) / 1000).toBeCloseTo(319.3, 0);
    expect(SIGHT_KM.at(-1)! * 1000).toBeGreaterThanOrEqual(reachM(CLOUD_HEIGHT_M.high));
  });

  it('samples along the geodesic at each distance', () => {
    const pts = sightPoints(rotterdam, 268.8);
    expect(pts[0]).toEqual(rotterdam);
    pts.slice(1).forEach((p, i) => {
      expect(distanceM(rotterdam, p) / 1000).toBeCloseTo(SIGHT_KM[i + 1], 1);
      expect(bearingDeg(rotterdam, p)).toBeCloseTo(268.8, 1);
    });
    expect(pts.at(-1)!.lng).toBeLessThan(0);
  });
});

describe('summarise', () => {
  it('averages low within low reach and mid within mid reach', () => {
    const s = flat(0, 0);
    s.find((x) => x.km === 160)!.low = 100;
    s.find((x) => x.km === 160)!.mid = 100;
    const r = summarise(s);
    expect(r.blockLow).toBe(0);
    expect(r.blockMid).toBeCloseTo(100 / 7, 5);
  });

  it('takes the canvas overhead only', () => {
    const s = flat(10, 10, 20);
    s[0] = { km: 0, low: 100, mid: 40, high: 90 };
    const r = summarise(s);
    expect([r.canvasMid, r.canvasHigh]).toEqual([40, 90]);
    expect(r.blockLow).toBe(10);
  });

  it('grades the verdict and never calls gaps clear', () => {
    expect(summarise(flat(10, 10)).verdict).toBe(SightVerdict.Clear);
    expect(summarise(flat(40, 10)).verdict).toBe(SightVerdict.Partial);
    expect(summarise(flat(10, 80)).verdict).toBe(SightVerdict.Blocked);
    expect(summarise(flat(NaN, 0)).verdict).toBe(SightVerdict.Unknown);
  });

  it('ignores single gaps in the mean', () => {
    const s = flat(60, 0);
    s[1].low = NaN;
    expect(summarise(s).blockLow).toBe(60);
  });
});
