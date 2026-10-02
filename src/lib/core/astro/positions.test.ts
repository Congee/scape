import { describe, expect, it } from 'vitest';
import { makeObserver, SkyBody } from './bodies';
import { litAreaFraction, MOON_NEW_MAX, moonPhaseName, moonTerminator, semidiameterDeg } from './positions';

describe('moon terminator', () => {
  it('covers exactly the illuminated fraction of the disc', () => {
    for (const lit of [0, 0.01, 0.1, 0.25, 0.4999, 0.5, 0.5001, 0.6, 0.75, 0.9, 0.992, 1]) {
      for (const waxing of [true, false]) {
        expect(litAreaFraction(moonTerminator(lit, waxing))).toBeCloseTo(lit, 10);
      }
    }
  });

  it('bows away from the lit limb past half phase, so a full moon is nearly the whole disc', () => {
    const full = moonTerminator(0.992, false);
    expect(full.gibbous).toBe(true);
    expect(full.rx).toBeCloseTo(0.984, 6);
    const crescent = moonTerminator(0.008, false);
    expect(crescent.gibbous).toBe(false);
    expect(crescent.rx).toBeCloseTo(0.984, 6);
  });

  it('puts the lit limb west when waxing', () => {
    expect(moonTerminator(0.3, true).litSide).toBe(1);
    expect(moonTerminator(0.3, false).litSide).toBe(-1);
  });
});

describe('semidiameter', () => {
  const obs = makeObserver({ lat: 40.747952, lng: -74.023685 }, 3);

  it('tracks the moon between perigee and apogee instead of a fixed mean', () => {
    // 2026-10-26 was a perigee full moon; 2026-11-10 is near apogee.
    const near = semidiameterDeg(SkyBody.Moon, new Date('2026-10-26T23:01:25Z'), obs);
    const far = semidiameterDeg(SkyBody.Moon, new Date('2026-11-10T12:00:00Z'), obs);
    expect(near).toBeCloseTo(0.2724, 3);
    expect(far).toBeLessThan(0.25);
    expect(near / far).toBeGreaterThan(1.1);
  });

  it('gives the sun about 16 arcminutes and the Galactic Centre none', () => {
    const sun = semidiameterDeg(SkyBody.Sun, new Date('2026-10-26T23:01:25Z'), obs);
    expect(sun).toBeGreaterThan(0.26);
    expect(sun).toBeLessThan(0.275);
    expect(semidiameterDeg(SkyBody.Gc, new Date('2026-10-26T23:01:25Z'), obs)).toBe(0);
  });
});

describe('moonPhaseName', () => {
  it('names phases in sentence case from the lit fraction', () => {
    expect(moonPhaseName(0.01, true)).toBe('New moon');
    expect(moonPhaseName(0.0333, true)).toBe('Waxing crescent');
    expect(moonPhaseName(0.2, false)).toBe('Waning crescent');
    expect(moonPhaseName(0.5, true)).toBe('First quarter');
    expect(moonPhaseName(0.46, false)).toBe('Last quarter');
    expect(moonPhaseName(0.7, true)).toBe('Waxing gibbous');
    expect(moonPhaseName(0.8, false)).toBe('Waning gibbous');
    expect(moonPhaseName(0.99, false)).toBe('Full moon');
  });
  it('never calls a moon above the threshold new', () => {
    for (const f of [MOON_NEW_MAX, 0.05, 0.1]) for (const w of [true, false]) expect(moonPhaseName(f, w)).not.toBe('New moon');
  });
});
