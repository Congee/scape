import { describe, expect, it } from 'vitest';
import { CAMERAS, LENSES, type CameraRow, type LensRow } from '@data/gearCatalog';
import { gearTokens, longApertureOf, normalizeGearText, scoreGear, searchGear } from './gearSearch';

const camHay = (r: CameraRow) => `${r[0]} ${r[1]} ${r[5]}`;
const lensHay = (r: LensRow) => `${r[0]} ${r[1]} ${r[5]}`;
const findCameras = (q: string) => searchGear(CAMERAS, camHay, gearTokens(q), () => 0, 6).map((r) => `${r[0]} ${r[1]}`);
const findLenses = (q: string) => searchGear(LENSES, lensHay, gearTokens(q), () => 0, 8).map((r) => `${r[0]} ${r[1]}`);

describe('normalizeGearText', () => {
  it('splits letter/digit boundaries so spelling with or without spaces agrees', () => {
    expect(normalizeGearText('Z8')).toBe('z 8');
    expect(normalizeGearText('Nikon Z 8')).toBe('nikon z 8');
    expect(normalizeGearText('a7iv')).toBe(normalizeGearText('α7 IV'));
    expect(normalizeGearText('S5II')).toBe(normalizeGearText('s5 ii'));
    expect(normalizeGearText('Z6III')).toBe('z 6 iii');
  });

  it('folds the alpha glyph and the f-stop slash', () => {
    expect(normalizeGearText('α7R V')).toBe('a 7 r v');
    expect(normalizeGearText('F2.8')).toBe('f 2.8');
    expect(normalizeGearText('f/2.8')).toBe('f 2.8');
  });

  it('keeps decimals intact', () => {
    expect(normalizeGearText('24-70mm F2.8')).toBe('24 70 mm f 2.8');
  });
});

describe('scoreGear', () => {
  it('rewards tokens that start a word', () => {
    expect(scoreGear('sony a 7 r v e', ['ony'])).toBe(1);
    expect(scoreGear('sony e 7 a', ['a', '7'])).toBe(4);
  });

  it('rewards the tokens appearing as one run of words', () => {
    expect(scoreGear('sony a 7 r v e', ['a', '7'])).toBeGreaterThan(scoreGear('sony e 7 a', ['a', '7']));
  });

  it('rejects a missing token', () => {
    expect(scoreGear('sony a 7 r v e', ['a', '9'])).toBe(-1);
  });
});

describe('catalogue queries', () => {
  it.each([
    ['z8', 'Nikon Z 8'],
    ['z 8', 'Nikon Z 8'],
    ['z6iii', 'Nikon Z6III'],
    ['z6 iii', 'Nikon Z6III'],
    ['a7iv', 'Sony α7 IV'],
    ['a7 iv', 'Sony α7 IV'],
    ['a7r v', 'Sony α7R V'],
    ['s5ii', 'Panasonic Lumix S5II'],
    ['r5 mark ii', 'Canon EOS R5 Mark II'],
    ['x-t5', 'Fujifilm X-T5']
  ])('%s finds %s', (q, model) => {
    expect(findCameras(q)).toContain(model);
  });

  it('still finds the 24-70 f/2.8 zooms, the mounted ones first', () => {
    const hits = findLenses('24-70 2.8');
    expect(hits.length).toBe(8);
    expect(hits.every((n) => n.includes('24-70'))).toBe(true);
    const onE = searchGear(LENSES, lensHay, gearTokens('24-70 2.8'), (r) => (r[5] === 'E' ? 3 : 0), 8).map((r) => `${r[0]} ${r[1]}`);
    expect(onE).toContain('Sony FE 24-70mm F2.8 GM II');
  });

  it('ranks the run of words the query spells first', () => {
    expect(findCameras('s5ii')[0]).toBe('Panasonic Lumix S5II');
    expect(findCameras('z8')[0]).toBe('Nikon Z 8');
  });

  it('finds a zoom written without spaces', () => {
    expect(findLenses('100-400')).toContain('Sony FE 100-400mm F4.5-5.6 GM OSS');
  });

  it('returns nothing for an empty query', () => {
    expect(findCameras('')).toEqual([]);
  });
});

describe('longApertureOf', () => {
  it('reads the long end out of both spellings', () => {
    expect(longApertureOf('EF 100-400mm f/4.5-5.6L IS II USM')).toBe(5.6);
    expect(longApertureOf('RF 100-400mm F5.6-8 IS USM')).toBe(8);
    expect(longApertureOf('RF 15-30mm F4.5-6.3 IS STM')).toBe(6.3);
    expect(longApertureOf('FE 200-600mm F5.6-6.3 G OSS')).toBe(6.3);
    expect(longApertureOf('XF100-400mmF4.5-5.6 R LM OIS WR')).toBe(5.6);
  });

  it('gives nothing for a constant-aperture lens or a prime', () => {
    expect(longApertureOf('FE 70-200mm F2.8 GM OSS II')).toBeNull();
    expect(longApertureOf('XF16-80mmF4 R OIS WR')).toBeNull();
    expect(longApertureOf('FE 600mm F4 GM OSS')).toBeNull();
  });

  it('never mistakes the focal range for the aperture', () => {
    expect(longApertureOf('XF16-80mmF4 R OIS WR')).not.toBe(80);
    expect(longApertureOf('FE 24-105mm F4 G OSS')).toBeNull();
  });

  it('agrees with every zoom row that spells a range', () => {
    const ranged = LENSES.filter((r) => longApertureOf(r[1]) !== null);
    expect(ranged.length).toBeGreaterThan(40);
    expect(ranged.every((r) => longApertureOf(r[1])! > r[4] && r[3] > r[2])).toBe(true);
  });
});
