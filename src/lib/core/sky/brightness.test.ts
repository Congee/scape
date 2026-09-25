import { describe, expect, it } from 'vitest';
import { bortleOf, cdm2ToMag, magToCdm2, magToNl, NATURAL_SKY_MAG, nelmFromSqm, nlToMag } from './brightness';

describe('sky brightness units', () => {
  it('puts the natural 22.0 mag/arcsec² sky near 171 µcd/m²', () => {
    expect(magToCdm2(NATURAL_SKY_MAG) * 1e6).toBeCloseTo(171.1, 0);
    expect(cdm2ToMag(magToCdm2(18.3))).toBeCloseTo(18.3, 10);
  });

  it('converts K&S nanolamberts both ways', () => {
    expect(magToNl(21.9)).toBeCloseTo(59.2, 0);
    expect(nlToMag(magToNl(19.2))).toBeCloseTo(19.2, 10);
  });

  it('gives a NELM near 6.6 for a 21.5 sky and fainter skies see deeper', () => {
    expect(nelmFromSqm(21.5)).toBeGreaterThan(6.3);
    expect(nelmFromSqm(21.5)).toBeLessThan(6.9);
    expect(nelmFromSqm(18)).toBeLessThan(nelmFromSqm(21));
  });
});

describe('bortleOf', () => {
  it.each([
    [22.0, '1'],
    [21.76, '1'],
    [21.7, '2'],
    [21.4, '3'],
    [21.0, '4'],
    [20.5, '4.5'],
    [19.5, '5'],
    [18.7, '6'],
    [18.2, '7'],
    [17.2, '8–9']
  ])('%f mag/arcsec² is class %s', (mag, label) => expect(bortleOf(mag).label).toBe(label));
});
