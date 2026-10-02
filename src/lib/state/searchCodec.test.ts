import { defaultParseSearch } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { stringifySearch } from './searchCodec';

describe('searchCodec', () => {
  it('keeps commas, colons and slashes literal', () => {
    expect(stringifySearch({ c: '40.7463,-74.1553', t: '2026-10-26T23:01Z', tz: 'America/New_York', z: 12.5 })).toBe('?c=40.7463,-74.1553&t=2026-10-26T23:01Z&tz=America/New_York&z=12.5');
  });

  it('still escapes what would break the query', () => {
    const s = stringifySearch({ q: 'a&b=c+d #e%f' });
    expect(s).toBe('?q=a%26b%3Dc%2Bd+%23e%25f');
    expect(defaultParseSearch(s)).toEqual({ q: 'a&b=c+d #e%f' });
  });

  it('round-trips through the default parser', () => {
    const search = { c: '40.7463,-74.1553', th: '120a', f: 200, tc: '1.4,2', s: 'sony-a7:35.9x24', n: '12' };
    expect(defaultParseSearch(stringifySearch(search))).toEqual(search);
    // Old percent-encoded links read the same.
    expect(defaultParseSearch('?c=40.7463%2C-74.1553&tz=America%2FNew_York')).toEqual({ c: '40.7463,-74.1553', tz: 'America/New_York' });
  });
});
