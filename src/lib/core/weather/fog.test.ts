import { describe, expect, it } from 'vitest';
import { FogReason, fogReasons } from './fog';

const clear = { code: 1, visibilityM: 24000, tempC: 12, dewC: 6, lowCloud: 0 };

describe('fogReasons', () => {
  it('names each sign that fired', () => {
    expect(fogReasons(clear)).toEqual([]);
    expect(fogReasons({ ...clear, code: 45 })).toEqual([FogReason.Code]);
    expect(fogReasons({ ...clear, code: 48, visibilityM: 400 })).toEqual([FogReason.Code, FogReason.Visibility]);
    expect(fogReasons({ ...clear, dewC: 11.5, lowCloud: 80 })).toEqual([FogReason.Spread]);
  });
  it('needs low cloud for the spread sign and ignores gaps', () => {
    expect(fogReasons({ ...clear, dewC: 11.5, lowCloud: 10 })).toEqual([]);
    expect(fogReasons({ code: NaN, visibilityM: NaN, tempC: NaN, dewC: NaN, lowCloud: NaN })).toEqual([]);
  });
});
