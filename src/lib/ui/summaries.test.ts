import { describe, expect, it } from 'vitest';
import { SightVerdict } from '@core/weather/sightline';
import { anyUnknown, mwReasons, mwVerdict, npfSummary, rowVerdict } from './summaries';

const mw = { visible: false, dark: true, coreUp: true, moonOk: true, sunAltDeg: -20, floorDeg: 10, moonIllumination: 0.02 };

describe('Milky Way summary', () => {
  it('leads with the verdict alone', () => {
    expect(mwVerdict({ visible: true })).toBe('Core visible now');
    expect(mwVerdict(mw)).toBe('Core not visible now');
  });

  it('lists each failed rule for the body', () => {
    expect(mwReasons(mw)).toEqual([]);
    expect(mwReasons({ ...mw, dark: false, sunAltDeg: 58.5, coreUp: false, moonOk: false })).toEqual(['sun at +58.5°', 'core needs +10.0°', 'moon up, 2% lit']);
  });
});

describe('npfSummary', () => {
  it('gives the NPF limit or what it needs', () => {
    expect(npfSummary(12.34, 24)).toBe('NPF 12.3 s at 24 mm');
    expect(npfSummary(null, 24)).toBe('NPF needs the pixel count');
  });
});

describe('sightline verdicts', () => {
  it('drops Unknown from rows and flags the list once', () => {
    expect(rowVerdict(SightVerdict.Unknown)).toBeUndefined();
    expect(rowVerdict(SightVerdict.Clear)).toBe(SightVerdict.Clear);
    expect(anyUnknown([SightVerdict.Clear, undefined])).toBe(false);
    expect(anyUnknown([SightVerdict.Clear, SightVerdict.Unknown, SightVerdict.Unknown])).toBe(true);
  });
});
