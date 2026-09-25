import { describe, expect, it } from 'vitest';
import { Units } from '@core/format';
import { ageText, pct, tempText, visText, windText } from './format';

describe('weather format', () => {
  it('says n/a for a missing value', () => {
    expect(pct(NaN)).toBe('n/a');
    expect(tempText(NaN, Units.Metric)).toBe('n/a');
  });
  it('formats both unit systems', () => {
    expect(tempText(10, Units.Imperial)).toBe('50 °F');
    expect(windText(16.09344, Units.Imperial)).toBe('10 mph');
    expect(visText(800, Units.Metric)).toBe('0.8 km');
    expect(visText(24140, Units.Metric)).toBe('24 km');
  });
  it('rounds ages', () => {
    expect(ageText(12 * 60_000)).toBe('12 min');
    expect(ageText(3 * 3_600_000)).toBe('3 h');
    expect(ageText(72 * 3_600_000)).toBe('3 d');
  });
});
