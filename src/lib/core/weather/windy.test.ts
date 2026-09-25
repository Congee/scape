import { describe, expect, it } from 'vitest';
import { windyUrl } from './windy';

describe('windyUrl', () => {
  it('formats 4 dp and the clouds overlay', () => {
    expect(windyUrl(51.92254, 4.47917)).toBe('https://www.windy.com/51.9225/4.4792?clouds,51.9225,4.4792,9');
  });
  it('wraps longitude and rounds zoom', () => {
    expect(windyUrl(-33.9, 198.5, 6.6)).toBe('https://www.windy.com/-33.9000/-161.5000?clouds,-33.9000,-161.5000,7');
  });
});
