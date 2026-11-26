import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeRgbaPng } from '@core/terrain/pngEncode';
import { encodeTerrarium } from '@core/terrain/terrarium';

vi.mock('./localTiles', () => ({ localTerrain: { tile: async () => null } }));

const { DemCache } = await import('./terrainTiles');

const SIZE = 4;
const png = (m: number) => {
  const b = encodeRgbaPng(encodeTerrarium(new Float32Array(SIZE * SIZE).fill(m), SIZE), SIZE, SIZE);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** Answers by `z/x/y`: a status, or elevation in metres for a 200. */
let answers: Record<string, number | { status: number }>;
const fetched: string[] = [];

beforeEach(() => {
  answers = {};
  fetched.length = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    const k = /(\d+\/\d+\/\d+)\.\w+$/.exec(url)![1];
    fetched.push(k);
    const a = answers[k] ?? { status: 404 };
    return typeof a === 'number' ? new Response(png(a)) : new Response(null, { status: a.status });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('DemCache past coverage', () => {
  it('overzooms a missing tile from the deepest ancestor that exists', async () => {
    answers['15/4/4'] = 12;
    const t = await new DemCache().load({ z: 17, x: 17, y: 18 });
    expect(t).toMatchObject({ z: 17, x: 17, y: 18, size: SIZE });
    expect(t!.elev.every((v) => v === 12)).toBe(true);
  });

  it('retries a missing tile whose ancestor failed transiently instead of caching a hole', async () => {
    answers['16/1/1'] = { status: 503 };
    const c = new DemCache();
    expect(await c.load({ z: 17, x: 2, y: 3 })).toBeNull();
    expect(c.get(17, 2, 3)).toBeUndefined();
    answers['16/1/1'] = 7;
    const t = await c.load({ z: 17, x: 2, y: 3 });
    expect(t?.elev[0]).toBe(7);
    // The known absence is not re-probed.
    expect(fetched.filter((k) => k === '17/2/3')).toHaveLength(1);
  });

  it('falls back to the parent for a tile with no valid post, as for a 404', async () => {
    answers['17/2/3'] = -32768;
    answers['16/1/1'] = 7;
    const t = await new DemCache().load({ z: 17, x: 2, y: 3 });
    expect(t?.elev.every((v) => v === 7)).toBe(true);
  });

  it('caches a tile absent at every zoom as absent', async () => {
    const c = new DemCache();
    expect(await c.load({ z: 2, x: 1, y: 1 })).toBeNull();
    expect(c.get(2, 1, 1)).toBeNull();
  });
});

describe('DemCache stats', () => {
  it('counts decoded tiles and their bytes apart from remembered absences', async () => {
    answers['3/1/1'] = 5;
    const c = new DemCache(10);
    await c.load({ z: 3, x: 1, y: 1 });
    await c.load({ z: 0, x: 0, y: 0 });
    expect(c.stats()).toEqual({ tiles: 1, nulls: 1, maxTiles: 10, bytes: SIZE * SIZE * 4, keys: ['3/1/1'] });
  });
});

describe('DemCache cap', () => {
  it('holds tiles past its cap while they are read, and returns to the cap once they are let go', async () => {
    const coords = [0, 1, 2, 3, 4].map((x) => ({ z: 3, x, y: 1 }));
    for (const c of coords) answers[`3/${c.x}/1`] = c.x;
    const c = new DemCache(2);
    const release = c.retain(coords);
    await c.loadAll(coords);
    expect(c.stats().tiles).toBe(5);
    release();
    expect(c.stats().tiles).toBe(2);
    // Least recently used go first.
    expect(c.stats().keys).toEqual(['3/3/1', '3/4/1']);
    release();
    expect(c.stats().tiles).toBe(2);
  });

  it('keeps tiles another reader still holds when one releases', async () => {
    const a = [0, 1, 2].map((x) => ({ z: 3, x, y: 1 }));
    const b = [{ z: 3, x: 0, y: 1 }, { z: 3, x: 1, y: 1 }];
    for (const t of a) answers[`3/${t.x}/1`] = t.x;
    const c = new DemCache(1);
    const ra = c.retain(a);
    const rb = c.retain(b);
    await c.loadAll(a);
    ra();
    expect(c.stats().keys.toSorted()).toEqual(['3/0/1', '3/1/1']);
    rb();
    expect(c.stats().tiles).toBe(1);
  });
});
