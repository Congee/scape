/* oxlint-disable no-await-in-loop -- repeated requests must run one after another */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOD2_RETRY_MS } from '@core/lod2/failures';
import type { Lod2Region } from '@core/lod2/regions';
import type { WalkContent } from '@core/lod2/tileset';
import { fetchLod2Tile, walkRegion } from './lod2Tiles';

const REGION = { id: 'nl', name: 'Test', tileset: '', bbox: [0, 0, 1, 1], licence: '', attribution: '', attributionUrl: '', geoidM: 0 } as unknown as Lod2Region;
const content = (url: string): WalkContent => ({ url, transform: new Float64Array(16), sphere: { x: 0, y: 0, z: 0, r: 1 }, distM: 0, geometricError: 0 });
const VIEW = { pin: { lng: 0.5, lat: 0.5 }, eyeH: 0, pxPerRad: 1000, maxErrorPx: 16, rangeM: 1000, azFromDeg: 0, azSpanDeg: 360 };

let now = 0;
let fetchMock: ReturnType<typeof vi.fn>;
let warn: ReturnType<typeof vi.spyOn>;
let seq = 0;
/** Module state lives for the worker's lifetime, so each test gets fresh URLs. */
const url = (name: string) => `https://t.test/${++seq}/${name}`;
const calls = (u: string) => fetchMock.mock.calls.filter(([v]) => v === u).length;

beforeEach(() => {
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const serve = (respond: (u: string) => Response | Promise<Response>) => {
  fetchMock = vi.fn((u: string) => Promise.resolve(respond(u)));
  vi.stubGlobal('fetch', fetchMock);
};

describe('fetchLod2Tile', () => {
  it('warns once for a 404 tile and never fetches it again', async () => {
    const u = url('gone.glb');
    serve(() => new Response(null, { status: 404 }));
    for (let i = 0; i < 3; i++) expect(await fetchLod2Tile(content(u), REGION)).toBeNull();
    expect(calls(u)).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('rejects an undecodable tile every time but decodes and warns once', async () => {
    const u = url('garbage.glb');
    serve(() => new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])));
    for (let i = 0; i < 3; i++) await expect(fetchLod2Tile(content(u), REGION)).rejects.toBeDefined();
    expect(calls(u)).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('retries a 503 tile only after the backoff, warning once', async () => {
    const u = url('busy.glb');
    serve(() => new Response(null, { status: 503 }));
    expect(await fetchLod2Tile(content(u), REGION)).toBeNull();
    expect(await fetchLod2Tile(content(u), REGION)).toBeNull();
    expect(calls(u)).toBe(1);
    now += LOD2_RETRY_MS;
    expect(await fetchLod2Tile(content(u), REGION)).toBeNull();
    expect(calls(u)).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('retries after a network failure', async () => {
    const u = url('offline.glb');
    fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchLod2Tile(content(u), REGION)).toBeNull();
    now += LOD2_RETRY_MS;
    expect(await fetchLod2Tile(content(u), REGION)).toBeNull();
    expect(calls(u)).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stays silent and retries at once after an abort', async () => {
    const u = url('aborted.glb');
    fetchMock = vi.fn(() => Promise.reject(new DOMException('superseded', 'AbortError')));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchLod2Tile(content(u), REGION)).toBeNull();
    expect(await fetchLod2Tile(content(u), REGION)).toBeNull();
    expect(calls(u)).toBe(2);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('walkRegion', () => {
  it('fetches a 404 tileset once across walks', async () => {
    const u = url('tileset.json');
    serve(() => new Response(null, { status: 404 }));
    for (let i = 0; i < 3; i++) expect(await walkRegion({ ...REGION, tileset: u }, VIEW)).toEqual([]);
    expect(calls(u)).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('fetches a garbled tileset once across walks', async () => {
    const u = url('tileset.json');
    serve(() => new Response('{ not json'));
    for (let i = 0; i < 3; i++) await walkRegion({ ...REGION, tileset: u }, VIEW);
    expect(calls(u)).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('retries a 503 tileset on a walk after the backoff', async () => {
    const u = url('tileset.json');
    serve(() => new Response(null, { status: 503 }));
    await walkRegion({ ...REGION, tileset: u }, VIEW);
    await walkRegion({ ...REGION, tileset: u }, VIEW);
    expect(calls(u)).toBe(1);
    now += LOD2_RETRY_MS;
    await walkRegion({ ...REGION, tileset: u }, VIEW);
    expect(calls(u)).toBe(2);
  });
});
