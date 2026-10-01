import { describe, expect, it } from 'vitest';
import { DIAL_R, needleEnd } from './dialGeometry';

describe('needleEnd', () => {
  it('points up for north and clockwise from there', () => {
    const cases: [number, number, number][] = [
      [0, 0, -DIAL_R],
      [90, DIAL_R, 0],
      [180, 0, DIAL_R],
      [270, -DIAL_R, 0],
      [360, 0, -DIAL_R]
    ];
    for (const [az, x, y] of cases) {
      const p = needleEnd(az);
      expect(p.x).toBeCloseTo(x, 9);
      expect(p.y).toBeCloseTo(y, 9);
    }
  });

  it('keeps the needle on the radius', () => {
    for (const az of [12.5, 133.03, 305.76, -45]) {
      const { x, y } = needleEnd(az, 4);
      expect(Math.hypot(x, y)).toBeCloseTo(4, 9);
    }
    const ne = needleEnd(45);
    expect(ne.x).toBeCloseTo(DIAL_R / Math.SQRT2, 9);
    expect(ne.y).toBeCloseTo(-DIAL_R / Math.SQRT2, 9);
  });
});
