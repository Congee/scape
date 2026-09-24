import { describe, expect, it } from 'vitest';
import { cloudAngleDeg, cloudDistanceM, cloudHeightM } from './clouds';

describe('cloud distance', () => {
  it('horizon distance d = √(2Rh), about 3.57 km·√h(m): a 1000 m base at 0° is 113 km away (no refraction)', () => {
    expect(cloudDistanceM(1000, 0, 0, 0)! / 1000).toBeCloseTo(3.57 * Math.sqrt(1000), 0);
  });

  it('flat-Earth trigonometry holds close by: a 1000 m base at 30° is about 1.73 km away', () => {
    expect(cloudDistanceM(1000, 30)!).toBeCloseTo(1000 / Math.tan(Math.PI / 6), -1);
  });

  it('distance, angle and height invert each other', () => {
    const d = cloudDistanceM(2500, 3, 120)!;
    expect(cloudAngleDeg(2500, d, 120)).toBeCloseTo(3, 9);
    expect(cloudHeightM(d, 3, 120)).toBeCloseTo(2500, 6);
    expect(cloudDistanceM(100, -5, 500)!).toBeCloseTo(400 / Math.tan((5 * Math.PI) / 180), -2);
    expect(cloudDistanceM(100, 5, 500)).toBeNull();
  });
});
