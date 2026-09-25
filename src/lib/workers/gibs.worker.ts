/// <reference lib="webworker" />
import { GIBS_NEAR_ZOOM, GIBS_TILE_PX, gibsNights, gibsNightTiles, gibsPlan, gibsTileKey, mercX, mercY, medianWindow, type GibsNight, type GibsTile } from '@core/sky/gibs';
import { decodeIndexedPng } from '@core/terrain/png';
import { clearGibs, GibsOfflineError, gibsTile, newestNight } from '@data/gibs';
import { GibsOutcome, type GibsClearRequest, type GibsRequest, type GibsResponse } from './gibs.protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** Parallel downloads, as the calibration's polite client. */
const POLITE = 4;
/** Decoded tiles kept between requests: two points' 8 nights with room to spare. */
const MEM_MAX = 256;
const mem = new Map<string, Uint8Array | null>();

// Corrupt or unpaletted tiles (GIBS serves some bad-granule days as plain imagery) read as no data.
async function decode(bytes: Uint8Array | null): Promise<Uint8Array | null> {
  if (!bytes) return null;
  try {
    const png = await decodeIndexedPng(bytes);
    return png.width === GIBS_TILE_PX && png.height === GIBS_TILE_PX ? png.index : null;
  } catch {
    return null;
  }
}

async function pool<T>(items: T[], n: number, f: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async (): Promise<void> => {
    if (next >= items.length) return;
    await f(items[next++]);
    return run();
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

async function handle(req: GibsRequest): Promise<GibsResponse> {
  const { id, p, win, nowMs } = req;
  const own: GibsTile = { z: GIBS_NEAR_ZOOM, row: Math.floor(mercY(p.lat, GIBS_NEAR_ZOOM) / GIBS_TILE_PX), col: Math.floor(mercX(p.lng, GIBS_NEAR_ZOOM) / GIBS_TILE_PX) };
  const dates = gibsNights(await newestNight(own, nowMs));
  const plan = gibsPlan(p, win);
  const nights = dates.map(() => new Map<string, Uint8Array | null>());
  let fetchedTiles = 0;
  let fetchedBytes = 0;
  const perNight = gibsNightTiles(plan, dates.length);
  const jobs = dates.flatMap((date, i) => perNight[i].map((t) => ({ date, i, t })));
  await pool(jobs, POLITE, async ({ date, i, t }) => {
    const key = `${date}/${gibsTileKey(t)}`;
    let index = mem.get(key);
    if (index === undefined) {
      const got = await gibsTile(date, t);
      if (got.fetched) {
        fetchedTiles++;
        fetchedBytes += got.fetched;
      }
      index = await decode(got.bytes);
      mem.set(key, index);
      if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value!);
    }
    nights[i].set(gibsTileKey(t), index);
  });
  const out = medianWindow(plan, nights as GibsNight[]);
  const withData = dates.filter((_, i) => [...nights[i].values()].some((t) => t !== null));
  return { id, outcome: GibsOutcome.Ready, win: out, nights: withData, fetchedTiles, fetchedBytes, tiles: jobs.length };
}

const inflight = new Set<Promise<unknown>>();

async function clear(id: number): Promise<GibsResponse> {
  await Promise.allSettled(inflight);
  mem.clear();
  await clearGibs();
  return { id, outcome: GibsOutcome.Cleared };
}

scope.addEventListener('message', (e: MessageEvent<GibsRequest | GibsClearRequest>) => {
  const id = e.data.id;
  const job = 'clear' in e.data ? clear(id) : handle(e.data);
  inflight.add(job);
  void job.finally(() => inflight.delete(job)).catch(() => {});
  job.then(
    (res) => scope.postMessage(res, res.outcome === GibsOutcome.Ready ? [res.win.data.buffer] : []),
    (err: unknown) => {
      const res: GibsResponse = err instanceof GibsOfflineError ? { id, outcome: GibsOutcome.Offline } : { id, outcome: GibsOutcome.Error, error: err instanceof Error ? err.message : String(err) };
      scope.postMessage(res);
    }
  );
});
