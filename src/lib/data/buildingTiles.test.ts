import { beforeEach, describe, expect, it, vi } from 'vitest';
import { yieldTurn } from './yieldTurn';

const getZxy = vi.fn<(z: number, x: number, y: number, signal?: AbortSignal) => Promise<{ data: ArrayBuffer } | undefined>>();

vi.mock('pmtiles', () => ({
  FetchSource: vi.fn(),
  PMTiles: class {
    getZxy = getZxy;
  }
}));
vi.mock('./localTiles', () => ({
  localBuildings: { tile: () => Promise.resolve(null) },
  readThrough: async <T>(local: () => Promise<T | null>, remote: () => Promise<T | null>) => (await local()) ?? remote()
}));

const { abandonBuildingFetches, fetchBuildingBatch } = await import('./buildingTiles');

let seq = 0;
/** Module state lives for the worker's lifetime, so each test gets fresh tiles. */
const tile = () => ({ z: 14, x: ++seq, y: 0 });
const calls = (t: { x: number }) => getZxy.mock.calls.filter(([, x]) => x === t.x).length;

beforeEach(() => {
  getZxy.mockReset();
  getZxy.mockResolvedValue(undefined);
});

describe('fetchBuildingBatch wanted', () => {
  it('drops a tile nobody wants before it hits the network, and fetches it when wanted again', async () => {
    const t = tile();
    expect(await fetchBuildingBatch(t, () => false)).toBeNull();
    expect(calls(t)).toBe(0);
    await fetchBuildingBatch(t);
    expect(calls(t)).toBe(1);
  });

  it('fetches a shared tile once while any caller still wants it', async () => {
    const t = tile();
    await Promise.all([fetchBuildingBatch(t, () => false), fetchBuildingBatch(t, () => true)]);
    expect(calls(t)).toBe(1);
  });

  it('aborts a fetch on the wire once nobody wants it', async () => {
    const t = tile();
    let signal: AbortSignal | undefined;
    getZxy.mockImplementation((_z, _x, _y, s) => {
      signal = s;
      return new Promise((_, reject) => s?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    });
    let wanted = true;
    const p = fetchBuildingBatch(t, () => wanted);
    // load yields a turn after taking its slot.
    await yieldTurn();
    await yieldTurn();
    abandonBuildingFetches();
    expect(signal?.aborted).toBe(false);
    wanted = false;
    abandonBuildingFetches();
    expect(signal?.aborted).toBe(true);
    expect(await p).toBeNull();
  });
});
