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

  it('caches a tile absent at every zoom as absent', async () => {
    const c = new DemCache();
    expect(await c.load({ z: 2, x: 1, y: 1 })).toBeNull();
    expect(c.get(2, 1, 1)).toBeNull();
  });
});
