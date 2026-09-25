import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeRgbaPng } from '@core/terrain/pngEncode';
import { encodeTerrarium } from '@core/terrain/terrarium';
import type { DemRequest } from '@workers/dem.protocol';

vi.mock('./localTiles', () => ({ localTerrain: { tile: async () => null } }));

type Handler = (params: { url: string }, abort: AbortController) => Promise<{ data: Uint8Array }>;
let handler: Handler;
vi.mock('maplibre-gl', () => ({
  addProtocol: (_name: string, fn: Handler) => {
    handler = fn;
  }
}));

const SIZE = 4;
const png = (m: number) => encodeRgbaPng(encodeTerrarium(new Float32Array(SIZE * SIZE).fill(m), SIZE), SIZE, SIZE);

/** Answers by `z/x/y`: a status, elevation in metres for a 200, or raw bytes for one. */
let answers: Record<string, number | Uint8Array | { status: number }>;
const fetched: string[] = [];
let demTiles: typeof import('./demTiles');

/** Requests the page posted to the DEM worker. */
const posted: DemRequest[] = [];

/** The real worker loop in-process; messages hop a microtask as they would a thread. */
class FakeWorker extends EventTarget {
  private serve = import('@workers/dem.serve').then(({ demServer }) => demServer((res) => this.dispatchEvent(new MessageEvent('message', { data: res }))));
  postMessage(req: DemRequest) {
    posted.push(req);
    void this.serve.then((serve) => serve(req));
  }
}

beforeEach(async () => {
  answers = {};
  fetched.length = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    const k = /(\d+\/\d+\/\d+)\.\w+$/.exec(url)![1];
    fetched.push(k);
    const a = answers[k] ?? { status: 404 };
    if (typeof a === 'number') return new Response(png(a).slice().buffer);
    return a instanceof Uint8Array ? new Response(a.slice().buffer) : new Response(null, { status: a.status });
  });
  posted.length = 0;
  vi.stubGlobal('Worker', FakeWorker);
  // The ancestor cache is module state.
  vi.resetModules();
  demTiles = await import('./demTiles');
});
afterEach(() => vi.unstubAllGlobals());

describe('loadDemTile', () => {
  it('falls back to the parent for a tile with no valid post, as for a 404', async () => {
    answers['17/2/3'] = -32768;
    answers['16/1/1'] = 7;
    const t = await demTiles.loadDemTile({ z: 17, x: 2, y: 3 });
    expect(t.elev.every((v) => v === 7)).toBe(true);
  });
});

describe('overzoom', () => {
  it('fails on a transiently failed parent instead of settling on an older ancestor, then retries it', async () => {
    answers['16/1/1'] = { status: 503 };
    answers['15/0/0'] = 3;
    await expect(demTiles.overzoom({ z: 17, x: 2, y: 3 })).rejects.toThrow();
    expect(fetched).not.toContain('15/0/0');
    answers['16/1/1'] = 7;
    const t = await demTiles.overzoom({ z: 17, x: 2, y: 3 });
    expect(t.elev.every((v) => v === 7)).toBe(true);
  });

  it('walks past a parent with no valid post', async () => {
    answers['16/1/1'] = -32768;
    answers['15/0/0'] = 3;
    const t = await demTiles.overzoom({ z: 17, x: 2, y: 3 });
    expect(t.elev.every((v) => v === 3)).toBe(true);
  });
});

describe('scape-dem protocol', () => {
  it('rebuilds a tile with no valid post from its parent', async () => {
    const { ensureDemProtocol } = await import('./demProtocol');
    ensureDemProtocol();
    answers['17/2/3'] = -32768;
    answers['16/1/1'] = 7;
    const { data } = await handler({ url: 'scape-dem://17/2/3' }, new AbortController());
    const { decodeTerrainTile } = await import('./terrainTiles');
    const dem = await decodeTerrainTile(data.slice().buffer);
    expect(dem.elev.every((v) => v === 7)).toBe(true);
  });

  it('passes a valid tile through untouched', async () => {
    const { ensureDemProtocol } = await import('./demProtocol');
    ensureDemProtocol();
    answers['17/2/3'] = 12;
    const { data } = await handler({ url: 'scape-dem://17/2/3' }, new AbortController());
    expect(data).toEqual(png(12));
    expect(fetched).toEqual(['17/2/3']);
    expect(posted).toEqual([{ id: 1, tile: { z: 17, x: 2, y: 3 }, format: 'encoded' }]);
  });

  it('lets an unreadable tile through for MapLibre to judge', async () => {
    const { ensureDemProtocol } = await import('./demProtocol');
    ensureDemProtocol();
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    answers['17/2/3'] = junk;
    const { data } = await handler({ url: 'scape-dem://17/2/3' }, new AbortController());
    expect(data).toEqual(junk);
  });

  it('errors the tile when its parent fails transiently', async () => {
    const { ensureDemProtocol } = await import('./demProtocol');
    ensureDemProtocol();
    answers['17/2/3'] = -32768;
    answers['16/1/1'] = { status: 503 };
    answers['15/0/0'] = 3;
    await expect(handler({ url: 'scape-dem://17/2/3' }, new AbortController())).rejects.toThrow(/HTTP 503/);
    expect(fetched).not.toContain('15/0/0');
  });

  it('cancels the worker request on abort', async () => {
    const { ensureDemProtocol } = await import('./demProtocol');
    ensureDemProtocol();
    answers['17/2/3'] = 12;
    const abort = new AbortController();
    const p = handler({ url: 'scape-dem://17/2/3' }, abort);
    abort.abort();
    await expect(p).rejects.toThrow(/Aborted/);
    expect(posted).toEqual([{ id: 1, tile: { z: 17, x: 2, y: 3 }, format: 'encoded' }, { id: 1, cancel: true }]);
  });
});
