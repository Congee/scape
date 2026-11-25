import { describe, expect, it } from 'vitest';
import { bool, checkFields, inRange, listOf, lngLat, nullable, num, oneOf, optional, parseJson, positive, record, str, timeZone, type Check, type Checks } from './check';

const Color = { Red: 'red', Blue: 'blue' } as const;
type Color = (typeof Color)[keyof typeof Color];

interface Thing {
  name: string;
  color: Color;
  size: number | null;
  tags: string[];
  note?: string;
}

const THING: Checks<Thing> = { name: str, color: oneOf(Color), size: nullable(num), tags: listOf(str), note: optional(str) };
const fallback: Thing = { name: 'x', color: Color.Red, size: null, tags: [] };

describe('primitive checks', () => {
  it('accept their type only', () => {
    expect([1, 0, -2.5].map(num)).toEqual([1, 0, -2.5]);
    for (const bad of [NaN, Infinity, '1', null, undefined, {}]) expect(num(bad)).toBeUndefined();
    expect(positive(0)).toBeUndefined();
    expect(str('')).toBe('');
    expect(str(1)).toBeUndefined();
    expect(bool(false)).toBe(false);
    expect(bool('false')).toBeUndefined();
    expect(inRange(-90, 90)(91)).toBeUndefined();
    expect(inRange(-90, 90)(NaN)).toBeUndefined();
  });

  it('checks enum membership by value', () => {
    expect(oneOf(Color)('blue')).toBe(Color.Blue);
    expect(oneOf(Color)('Blue')).toBeUndefined();
    expect(oneOf(Color)('toString')).toBeUndefined();
  });

  it('keeps the good items of a list', () => {
    expect(listOf(num)([1, 'a', 2, null])).toEqual([1, 2]);
    expect(listOf(num)({ 0: 1 })).toBeUndefined();
  });

  it('reads zones and JSON without throwing', () => {
    expect(timeZone('Asia/Tokyo')).toBe('Asia/Tokyo');
    for (const bad of ['', 'Mars/Olympus', 3]) expect(timeZone(bad)).toBeUndefined();
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('{')).toBeUndefined();
  });
});

describe('record', () => {
  const thing = record(THING);

  it('needs every required key and drops unknown ones', () => {
    expect(thing({ name: 'a', color: 'blue', size: 3, tags: ['t'], extra: 1 })).toEqual({ name: 'a', color: 'blue', size: 3, tags: ['t'] });
    expect(thing({ name: 'a', color: 'green', size: 3, tags: [] })).toBeUndefined();
    expect(thing({ name: 'a', color: 'red', tags: [] })).toBeUndefined();
    for (const bad of [null, [], 'a', 1]) expect(thing(bad)).toBeUndefined();
  });

  it('drops a bad optional key and keeps the record', () => {
    expect(thing({ name: 'a', color: 'red', size: null, tags: [], note: 5 })).toEqual({ name: 'a', color: 'red', size: null, tags: [] });
    expect(thing({ name: 'a', color: 'red', size: null, tags: [], note: 'n' })?.note).toBe('n');
  });

  it('reads points with optional precision', () => {
    expect(lngLat({ lat: 1, lng: 2, digits: { lat: 4, lng: 4 } })).toEqual({ lat: 1, lng: 2, digits: { lat: 4, lng: 4 } });
    expect(lngLat({ lat: 1, lng: 2, digits: 'x' })).toEqual({ lat: 1, lng: 2 });
    expect(lngLat({ lat: 91, lng: 2 })).toBeUndefined();
  });
});

describe('checkFields', () => {
  it('replaces each bad or missing field with the fallback', () => {
    expect(checkFields(THING, { name: 7, color: 'green', size: 2, tags: 'no' }, fallback)).toEqual({ ...fallback, size: 2 });
    expect(checkFields(THING, { note: 'n', stale: true }, fallback)).toEqual({ ...fallback, note: 'n' });
  });

  it('falls back whole on a non-object', () => {
    for (const bad of [undefined, null, 'x', 3, [1]]) expect(checkFields(THING, bad, fallback)).toEqual(fallback);
  });

  it('is keyed by the type, so a missing or wrong check fails to compile', () => {
    // @ts-expect-error: `tags` has no check
    const missing: Checks<Thing> = { name: str, color: oneOf(Color), size: nullable(num), note: optional(str) };
    // @ts-expect-error: a string check cannot stand for an enum field
    const loose: Checks<Thing> = { ...THING, color: str };
    // @ts-expect-error: an optional key needs `optional`
    const bare: Checks<Thing> = { ...THING, note: str };
    // @ts-expect-error: a wider enum cannot stand for a narrower one
    const wide: Check<typeof Color.Red> = oneOf(Color);
    expect([missing, loose, bare, wide]).toHaveLength(4);
  });
});
