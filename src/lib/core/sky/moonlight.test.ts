import { describe, expect, it } from 'vitest';
import { ksAirmass, ksMoonIlluminance, ksScatter, moonlitSky, phaseAngleDeg, separationDeg } from './moonlight';

describe('Krisciunas & Schaefer moonlight', () => {
  it('has the paper’s airmass, scattering and phase terms', () => {
    expect(ksAirmass(0)).toBe(1);
    expect(ksAirmass(60)).toBeCloseTo(1 / Math.sqrt(0.28), 10);
    expect(Number.isFinite(ksAirmass(90))).toBe(true);
    expect(ksScatter(10)).toBeGreaterThan(ksScatter(90));
    expect(ksMoonIlluminance(0)).toBeGreaterThan(10 * ksMoonIlluminance(120));
    expect(phaseAngleDeg(1)).toBeCloseTo(0, 6);
    expect(phaseAngleDeg(0.5)).toBeCloseTo(90, 6);
  });

  it('adds nothing with the moon down or new', () => {
    expect(moonlitSky(21.5, 60, -5, 40, 1).deltaMag).toBe(0);
    expect(moonlitSky(21.5, 60, 40, 40, 0).deltaMag).toBe(0);
  });

  // K&S Table 2 / Fig. 1 scale: a high full moon brightens a dark zenith by roughly 3–4 mag.
  it('brightens a dark sky by a few magnitudes under a full moon', () => {
    const full = moonlitSky(21.7, 90, 60, 30, 1);
    expect(full.deltaMag).toBeLessThan(-2.5);
    expect(full.deltaMag).toBeGreaterThan(-5);
    expect(moonlitSky(21.7, 90, 60, 30, 0.25).deltaMag).toBeGreaterThan(full.deltaMag);
    expect(moonlitSky(18.5, 90, 60, 30, 1).deltaMag).toBeGreaterThan(full.deltaMag);
  });

  it('leaves a totally eclipsed full moon a near-dark sky', () => {
    expect(moonlitSky(21.7, 90, 60, 30, 1, 2e-4).deltaMag).toBeGreaterThan(-0.05);
    expect(moonlitSky(21.7, 90, 60, 30, 1, 0.5).deltaMag).toBeGreaterThan(moonlitSky(21.7, 90, 60, 30, 1).deltaMag);
  });

  it('is brighter near the moon than 90° away', () => {
    expect(moonlitSky(21.7, 40, 40, 5, 1).mag).toBeLessThan(moonlitSky(21.7, 40, 40, 90, 1).mag);
  });

  it('measures horizontal separations', () => {
    expect(separationDeg(10, 20, 10, 20)).toBeCloseTo(0, 6);
    expect(separationDeg(0, 0, 90, 0)).toBeCloseTo(90, 6);
    expect(separationDeg(0, 90, 123, 30)).toBeCloseTo(60, 6);
  });
});
