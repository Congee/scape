import { describe, expect, it } from 'vitest';
import { dedup, dedupKey, sourceOf, type Entry } from './console-flows';

const e = (text: string, at = ''): Entry => ({ kind: 'console (page)', level: 'warning', text, at });

describe('dedup', () => {
  it('merges repeats that differ only in numbers, ids, queries and position', () => {
    const a = e('tile 12/3/4 failed', 'http://x/a.js?v=1:10:2');
    const b = e('tile 13/5/6 failed', 'http://x/a.js?v=2:99:7');
    expect(dedupKey(a)).toBe(dedupKey(b));
    expect(dedupKey(e('model 0b6f7c1e-1111-4222-8333-944445555666 gone'))).toBe(dedupKey(e('model 1c6f7c1e-1111-4222-8333-944445555666 gone')));
    expect(dedupKey(a)).not.toBe(dedupKey({ ...a, level: 'error' }));
  });

  it('counts repeats and lists each step once', () => {
    const rows = dedup([
      { ...e('late'), step: 'a' },
      { ...e('early'), step: 'a' },
      { ...e('late'), step: 'a' },
      { ...e('late'), step: 'b' }
    ]);
    expect(rows.map((r) => [r.entry.text, r.count, r.steps])).toEqual([
      ['late', 3, ['a', 'b']],
      ['early', 1, ['a']]
    ]);
  });
});

describe('sourceOf', () => {
  it('names third-party messages and calls the rest ours', () => {
    expect(sourceOf(e('layers[road_shield_us].filter[1]: Expected value to be of type number'))).toMatch(/Liberty/);
    expect(sourceOf(e('Image "atm" could not be loaded. Please make sure you have added the image'))).toMatch(/sprite/);
    expect(sourceOf(e('Failed to load resource', 'http://localhost:1/favicon.ico'))).toMatch(/browser/);
    expect(sourceOf(e('layers[overture-building].paint.fill-extrusion-height[2][1]: Expected value'))).toBe('ours');
  });
});
