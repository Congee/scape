import { SearchHourAngle } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { makeObserver, POLARIS_BODY } from './bodies';
import { polarisAid } from './polaris';

const obs = makeObserver({ lat: 45, lng: 7 });
const clockDiff = (a: number, b: number) => Math.min(Math.abs(a - b), 12 - Math.abs(a - b));

describe('Polaris aid', () => {
  it('reads 12 o’clock at upper culmination and 9 six hours later', () => {
    const transit = SearchHourAngle(POLARIS_BODY, obs, 0, new Date('2026-03-01T00:00:00Z'), 1).time.date;
    const a = polarisAid(transit, obs);
    expect(clockDiff(a.clockSky, 12)).toBeLessThan(0.05);
    expect(clockDiff(a.clockScope, 6)).toBeLessThan(0.05);
    expect(a.separationDeg).toBeGreaterThan(0.55);
    expect(a.separationDeg).toBeLessThan(0.75);
    expect(a.poleAltDeg).toBe(45);
    expect(Math.abs(a.polarisAltDeg - 45 - a.separationDeg)).toBeLessThan(0.05);
    const later = polarisAid(new Date(transit.getTime() + 6 * 3_600_000), obs);
    expect(clockDiff(later.clockSky, 9)).toBeLessThan(0.1);
    expect(later.polarisAzDeg).toBeGreaterThan(358);
  });

  it('flags the southern hemisphere', () => {
    const s = polarisAid(new Date('2026-03-01T00:00:00Z'), makeObserver({ lat: -33.9, lng: 151.2 }));
    expect(s.northern).toBe(false);
    expect(s.poleAzDeg).toBe(180);
    expect(s.polarisAltDeg).toBeLessThan(0);
  });
});
