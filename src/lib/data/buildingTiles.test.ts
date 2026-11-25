import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { yieldTurn } from './yieldTurn';

const fetchSource = vi.fn();
const getZxy = vi.fn<(z: number, x: number, y: number, signal?: AbortSignal) => Promise<{ data: ArrayBuffer } | undefined>>();

vi.mock('pmtiles', () => ({
  FetchSource: fetchSource,
  PMTiles: class {
    getZxy = getZxy;
  }
}));
vi.mock('./localTiles', () => ({
  localBuildings: { tile: () => Promise.resolve(null) },
  readThrough: async <T>(local: () => Promise<T | null>, remote: () => Promise<T | null>) => (await local()) ?? remote()
}));

const { abandonBuildingFetches, fetchBuildingBatch, setBuildingsRelease } = await import('./buildingTiles');
// As a worker: the release comes from the main thread, never from the network.
setBuildingsRelease('2026-12-16.0');

let seq = 0;
/** Module state lives for the worker's lifetime, so each test gets fresh tiles. */
const tile = () => ({ z: 14, x: ++seq, y: 0 });
const calls = (t: { x: number }) => getZxy.mock.calls.filter(([, x]) => x === t.x).length;

beforeEach(() => {
  getZxy.mockReset();
  getZxy.mockResolvedValue(undefined);
});

describe('live archive', () => {
  it('reads the release the main thread sent', async () => {
    await fetchBuildingBatch(tile());
    expect(fetchSource).toHaveBeenLastCalledWith('https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-12-16.0/buildings.pmtiles');
  });
});

/** A fresh main-thread module, as on page load. */
const fresh = async (fetchImpl: typeof fetch, onLine = true) => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(fetchImpl));
  vi.stubGlobal('navigator', { onLine });
  return (await import('./buildingTiles')).buildingsRelease;
};

describe('buildingsRelease', () => {
  const xml = '<ListBucketResult><Contents><Key>tiles/2026-10-21.0/buildings.pmtiles</Key></Contents><Contents><Key>tiles/2026-11-18.0/buildings.pmtiles</Key></Contents></ListBucketResult>';
  afterEach(() => vi.unstubAllGlobals());

  it('lists the bucket once and takes the newest release', async () => {
    const release = await fresh(async () => new Response(xml));
    expect(await Promise.all([release(), release()])).toEqual(['2026-11-18.0', '2026-11-18.0']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the pinned release when the listing fails or is garbled', async () => {
    const { OVERTURE_BUILDINGS_RELEASE } = await import('./buildingTiles');
    expect(await (await fresh(() => Promise.reject(new TypeError('Failed to fetch'))))()).toBe(OVERTURE_BUILDINGS_RELEASE);
    expect(await (await fresh(async () => new Response('denied', { status: 403 })))()).toBe(OVERTURE_BUILDINGS_RELEASE);
    expect(await (await fresh(async () => new Response('<ListBucketResult/>')))()).toBe(OVERTURE_BUILDINGS_RELEASE);
  });

  it('does not list the bucket offline', async () => {
    const { OVERTURE_BUILDINGS_RELEASE } = await import('./buildingTiles');
    const release = await fresh(async () => new Response(xml), false);
    expect(await release()).toBe(OVERTURE_BUILDINGS_RELEASE);
    expect(fetch).not.toHaveBeenCalled();
  });
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
