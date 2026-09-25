import { describe, expect, it } from 'vitest';
import { FOG_TEXT, FogReason, fogReasons } from './fog';

const clear = { code: 1, visibilityM: 24000, tempC: 12, dewC: 6, lowCloud: 0 };

describe('fogReasons', () => {
  it('names each sign that fired', () => {
    expect(fogReasons(clear)).toEqual([]);
    expect(fogReasons({ ...clear, code: 45 })).toEqual([FogReason.Code]);
    expect(fogReasons({ ...clear, code: 48, visibilityM: 400 })).toEqual([FogReason.Code, FogReason.Visibility]);
    expect(fogReasons({ ...clear, dewC: 11.5, lowCloud: 80 })).toEqual([FogReason.Spread]);
  });
  it('counts mist under 5 km as a sign, not haze above it', () => {
    expect(fogReasons({ ...clear, visibilityM: 4900 })).toEqual([FogReason.Visibility]);
    expect(fogReasons({ ...clear, visibilityM: 5000 })).toEqual([]);
    expect(FOG_TEXT.Visibility).toBe('visibility < 5 km');
  });
  it('wants a near-saturated surface under mostly low cloud', () => {
    expect(fogReasons({ ...clear, dewC: 11.1, lowCloud: 75 })).toEqual([]);
    expect(fogReasons({ ...clear, dewC: 10.9, lowCloud: 95 })).toEqual([]);
  });
  it('needs low cloud for the spread sign and ignores gaps', () => {
    expect(fogReasons({ ...clear, dewC: 11.5, lowCloud: 10 })).toEqual([]);
    expect(fogReasons({ code: NaN, visibilityM: NaN, tempC: NaN, dewC: NaN, lowCloud: NaN })).toEqual([]);
  });
});
