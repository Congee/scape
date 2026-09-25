import { describe, expect, it } from 'vitest';
import { windyMapUrl, windyUrl } from './windy';

describe('windyUrl', () => {
  it('formats 4 dp and the clouds overlay', () => {
    expect(windyUrl(51.92254, 4.47917)).toBe('https://www.windy.com/51.9225/4.4792?clouds,51.9225,4.4792,9');
  });
  it('wraps longitude and rounds zoom', () => {
    expect(windyUrl(-33.9, 198.5, 8.6)).toBe('https://www.windy.com/-33.9000/-161.5000?clouds,-33.9000,-161.5000,9');
  });
  it('drops the forecast pin below zoom 8, which Windy would force up', () => {
    expect(windyUrl(39.7392, -104.9903, 7)).toBe('https://www.windy.com/?clouds,39.7392,-104.9903,7');
  });
  it('clamps to Windy zoom 3..16', () => {
    expect(windyUrl(0, 0, 1)).toBe('https://www.windy.com/?clouds,0.0000,0.0000,3');
    expect(windyUrl(0, 0, 20)).toBe('https://www.windy.com/0.0000/0.0000?clouds,0.0000,0.0000,16');
  });
});

describe('windyMapUrl', () => {
  it('runs one zoom above MapLibre for the same ground scale', () => {
    expect(windyMapUrl(51.9225, 4.4792, 5)).toBe('https://www.windy.com/?clouds,51.9225,4.4792,6');
    expect(windyMapUrl(51.9225, 4.4792, 8)).toBe('https://www.windy.com/51.9225/4.4792?clouds,51.9225,4.4792,9');
    expect(windyMapUrl(45.9763, 7.6586, 14)).toBe('https://www.windy.com/45.9763/7.6586?clouds,45.9763,7.6586,15');
    expect(windyMapUrl(45.9763, 7.6586, 8.4)).toBe('https://www.windy.com/45.9763/7.6586?clouds,45.9763,7.6586,9');
  });
});
