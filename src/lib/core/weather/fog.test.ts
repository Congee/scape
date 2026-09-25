import { describe, expect, it } from 'vitest';
import { FOG_TEXT, FogClass, FogReason, fogSigns } from './fog';

const clear = { code: 1, visibilityM: 24000, tempC: 12, dewC: 6, lowCloud: 0 };
const cls = (x: Partial<typeof clear>, blind?: FogClass) => fogSigns({ ...clear, ...x }, blind).cls;

describe('fogSigns', () => {
  it('names each sign that fired', () => {
    expect(fogSigns(clear)).toEqual({ cls: FogClass.None, reasons: [] });
    expect(fogSigns({ ...clear, code: 45 })).toEqual({ cls: FogClass.Fog, reasons: [FogReason.Code] });
    expect(fogSigns({ ...clear, code: 48, visibilityM: 400 }).reasons).toEqual([FogReason.Code, FogReason.FogVisibility]);
    expect(fogSigns({ ...clear, dewC: 11.5, lowCloud: 80 })).toEqual({ cls: FogClass.Mist, reasons: [FogReason.Spread] });
  });
  it('splits fog below 1 km from mist below 5 km', () => {
    expect(cls({ visibilityM: 999 })).toBe(FogClass.Fog);
    expect(cls({ visibilityM: 1000 })).toBe(FogClass.Mist);
    expect(cls({ visibilityM: 4999 })).toBe(FogClass.Mist);
    expect(cls({ visibilityM: 5000 })).toBe(FogClass.None);
    expect(fogSigns({ ...clear, visibilityM: 3000 }).reasons).toEqual([FogReason.MistVisibility]);
    expect(FOG_TEXT.FogVisibility).toBe('visibility < 1 km');
    expect(FOG_TEXT.MistVisibility).toBe('visibility 1–5 km');
  });
  it('keeps the spread sign at mist unless visibility says fog', () => {
    const wet = { dewC: 11.5, lowCloud: 90 };
    expect(cls({ ...wet, visibilityM: 8000 })).toBe(FogClass.Mist);
    expect(cls({ ...wet, visibilityM: 800 })).toBe(FogClass.Fog);
    expect(cls({ ...wet, visibilityM: 8000 }, FogClass.Fog)).toBe(FogClass.Mist);
  });
  it('without visibility, the spread sign gives the blind class and codes give fog', () => {
    const blind = { visibilityM: NaN, dewC: 11.5, lowCloud: 90 };
    expect(cls(blind)).toBe(FogClass.Mist);
    expect(cls(blind, FogClass.Fog)).toBe(FogClass.Fog);
    expect(cls({ visibilityM: NaN, code: 45 })).toBe(FogClass.Fog);
  });
  it('wants a near-saturated surface under mostly low cloud', () => {
    expect(cls({ dewC: 11.1, lowCloud: 75 })).toBe(FogClass.None);
    expect(cls({ dewC: 10.9, lowCloud: 95 })).toBe(FogClass.None);
  });
  it('ignores gaps', () => {
    expect(fogSigns({ code: NaN, visibilityM: NaN, tempC: NaN, dewC: NaN, lowCloud: NaN })).toEqual({ cls: FogClass.None, reasons: [] });
  });
});
