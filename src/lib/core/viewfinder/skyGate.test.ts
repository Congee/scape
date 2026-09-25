import { describe, expect, it } from 'vitest';
import { PRIMARY_DEG, rainbowTop, SECONDARY_DEG } from '@core/astro/rainbow';
import { starNight } from './skyGate';

describe('starNight', () => {
  it('is 0 in daylight and 1 in astronomical night', () => {
    expect(starNight(10)).toBe(0);
    expect(starNight(-4)).toBe(0);
    expect(starNight(-18)).toBe(1);
  });

  it('never lets stars and a bow share a frame', () => {
    for (let alt = -90; alt <= 90; alt += 0.01) {
      const bow = rainbowTop(0, alt, PRIMARY_DEG).possible || rainbowTop(0, alt, SECONDARY_DEG).possible;
      if (bow) expect(starNight(alt), `sun ${alt.toFixed(2)}°`).toBe(0);
    }
  });
});
