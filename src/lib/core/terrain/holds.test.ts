import { describe, expect, it } from 'vitest';
import { evictionKeys, Holds } from './holds';

const held = (...keys: string[]) => new Set(keys);

describe('evictionKeys', () => {
  it('drops nothing while the cache is within its budget', () => {
    expect(evictionKeys(['a', 'b', 'c'], held(), 0)).toEqual([]);
    expect(evictionKeys(['a', 'b', 'c'], held(), -2)).toEqual([]);
  });

  it('drops the oldest keys first', () => {
    expect(evictionKeys(['a', 'b', 'c', 'd'], held(), 2)).toEqual(['a', 'b']);
  });

  it('walks past held keys instead of dropping them', () => {
    expect(evictionKeys(['a', 'b', 'c', 'd'], held('a', 'b'), 2)).toEqual(['c', 'd']);
  });

  it('returns fewer than asked rather than dropping a held key', () => {
    expect(evictionKeys(['a', 'b', 'c'], held('a', 'b'), 2)).toEqual(['c']);
    expect(evictionKeys(['a', 'b'], held('a', 'b'), 2)).toEqual([]);
  });
});

describe('Holds', () => {
  it('holds a key until every retain on it is released', () => {
    const h = new Holds();
    const r1 = h.retain(['a', 'b']);
    const r2 = h.retain(['b']);
    expect(h.has('a')).toBe(true);
    expect(h.has('b')).toBe(true);
    r1();
    expect(h.has('a')).toBe(false);
    expect(h.has('b')).toBe(true);
    r2();
    expect(h.has('b')).toBe(false);
    expect(h.size).toBe(0);
  });

  it('ignores a repeated release, so another holder keeps its key', () => {
    const h = new Holds();
    const r1 = h.retain(['a']);
    h.retain(['a']);
    r1();
    r1();
    expect(h.has('a')).toBe(true);
  });

  it('holds a key it is given twice in one retain until that retain is released', () => {
    const h = new Holds();
    const r = h.retain(['a', 'a']);
    expect(h.has('a')).toBe(true);
    r();
    expect(h.size).toBe(0);
  });
});
