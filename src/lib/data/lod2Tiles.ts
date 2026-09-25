import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { geoidAt, type GeoidGrid } from '@core/geo/geoid';
import { isB3dm, readB3dm, type B3dm } from '@core/lod2/b3dm';
import { fetchFault, httpFault, Lod2Failures, Lod2Fault } from '@core/lod2/failures';
import { lod2Tile, type Lod2Tile } from '@core/lod2/tile';
import { walkTileset, type TilesetJson, type WalkContent, type WalkView } from '@core/lod2/tileset';
import type { Lod2Region } from '@core/lod2/regions';
import { gltfUsesDraco, readGlbWorld, type DracoDecoder } from '@core/model/gltf';
import { readGeoid } from './geoid';
import { yieldTurn } from './yieldTurn';

const CONCURRENCY = 6;
/** External tilesets a walk may still name after this many rounds are left out. */
const WALK_ROUNDS = 6;

let maxCachedTiles = 24;

/** The mask worker holds its own copy of this module, so it sizes the cache for the map rect. */
export function setLod2TileCacheSize(n: number): void {
  maxCachedTiles = n;
}

const tilesets = new Map<string, TilesetJson>();
const tilesetInflight = new Map<string, Promise<void>>();
/** Failed tilesets and tiles; a failed tileset also stays out of the rest of its walk. */
const faults = new Lod2Failures(() => performance.now());

function fault(url: string, f: Lod2Fault, detail: unknown): void {
  if (faults.record(url, f)) console.warn(`[scape] LoD2 ${f === Lod2Fault.Permanent ? 'skipped' : 'failed, will retry'}:`, url, detail);
}

async function fetchTileset(url: string): Promise<void> {
  let text: string;
  try {
    const res = await fetch(url);
    if (!res.ok) return fault(url, httpFault(res.status), `HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    return fault(url, fetchFault(err), err);
  }
  try {
    tilesets.set(url, JSON.parse(text) as TilesetJson);
  } catch (err) {
    fault(url, Lod2Fault.Permanent, err);
  }
}

function loadTileset(url: string): Promise<void> {
  let p = tilesetInflight.get(url);
  if (!p) {
    p = fetchTileset(url).finally(() => tilesetInflight.delete(url));
    tilesetInflight.set(url, p);
  }
  return p;
}

/** Contents the view needs, nearest first, after fetching every external tileset the walk reaches. */
export async function walkRegion(region: Lod2Region, view: WalkView): Promise<WalkContent[]> {
  for (let round = 0; ; round++) {
    const r = walkTileset(region.tileset, (u) => tilesets.get(u), view);
    const todo = r.pending.filter((u) => !faults.blocked(u));
    if (todo.length === 0 || round === WALK_ROUNDS) return r.contents;
    // oxlint-disable-next-line no-await-in-loop -- each round's tilesets name the next ones
    await Promise.all(todo.map(loadTileset));
  }
}

const cache = new Map<string, Lod2Tile>();
/** A fetch and the callers still waiting on it; one nobody wants is dropped before it hits the network or aborted on it. */
interface Inflight {
  p: Promise<Lod2Tile | null>;
  wants: (() => boolean)[];
  abort: AbortController;
}
const inflight = new Map<string, Inflight>();
const waiting: (() => void)[] = [];
let active = 0;

function touch(key: string, t: Lod2Tile): void {
  cache.delete(key);
  cache.set(key, t);
  while (cache.size > maxCachedTiles) cache.delete(cache.keys().next().value!);
}

let geoidKey = '';
let geoid: Promise<GeoidGrid | null> | null = null;
/** Bumped on a geoid change, so a load that started on the old grid is not cached. */
let geoidGen = 0;

/** Drops every tile built on another geoid; the grid itself is read on the first PLATEAU tile. */
export function setLod2Geoid(key: string): void {
  if (key === geoidKey) return;
  geoidKey = key;
  geoid = null;
  geoidGen++;
  cache.clear();
  inflight.clear();
}

function gsiGeoid(): Promise<GeoidGrid | null> {
  geoid ??= readGeoid().catch((e: unknown) => {
    console.warn('[scape] geoid read failed:', e);
    return null;
  });
  return geoid;
}

let draco: Promise<DracoDecoder> | null = null;

/** The Draco decoder chunk and WASM, fetched on the first tile that needs them. */
function dracoDecoder(): Promise<DracoDecoder> {
  draco ??= import('./draco').then((m) => m.loadDraco());
  draco.catch(() => (draco = null));
  return draco;
}

async function acquire(): Promise<void> {
  if (active < CONCURRENCY) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
}

function release(): void {
  active--;
  waiting.shift()?.();
}

/** Null when the tile is absent or unreachable; a decode failure rejects. */
async function load(c: WalkContent, region: Lod2Region, f: Inflight): Promise<Lod2Tile | null> {
  const gen = geoidGen;
  await acquire();
  let buf: ArrayBuffer;
  try {
    // A Stop queued behind busy work must land before a freed slot fetches.
    await yieldTurn();
    if (f.abort.signal.aborted || !f.wants.some((w) => w())) return null;
    const res = await fetch(c.url, { signal: f.abort.signal });
    if (!res.ok) {
      fault(c.url, httpFault(res.status), `HTTP ${res.status}`);
      return null;
    }
    buf = await res.arrayBuffer();
  } catch (err) {
    if (!f.abort.signal.aborted) fault(c.url, fetchFault(err), err);
    return null;
  } finally {
    release();
  }
  let b: B3dm;
  let needsDraco: boolean;
  try {
    b = isB3dm(buf) ? readB3dm(buf) : { glb: buf, rtc: undefined, batch: {} };
    needsDraco = gltfUsesDraco(b.glb);
  } catch (err) {
    throw undecodable(c.url, err);
  }
  await MeshoptDecoder.ready;
  let dec: DracoDecoder | undefined;
  try {
    dec = needsDraco ? await dracoDecoder() : undefined;
  } catch (err) {
    fault(c.url, Lod2Fault.Transient, err);
    return null;
  }
  let t: Lod2Tile;
  try {
    const w = readGlbWorld(b.glb, { meshopt: MeshoptDecoder, draco: dec });
    w.rtc ??= b.rtc;
    const grid = region.gsiGeoid && geoidKey ? await gsiGeoid() : null;
    t = lod2Tile(w, c.transform, region, b.batch, grid ? (lat, lng) => geoidAt(grid, lat, lng) : undefined);
  } catch (err) {
    throw undecodable(c.url, err);
  }
  faults.succeeded(c.url);
  if (gen === geoidGen) touch(c.url, t);
  return t;
}

/** Content that did not decode, kept so a later request rejects the same way without the work. */
const undecoded = new Map<string, unknown>();

function undecodable(url: string, err: unknown): unknown {
  fault(url, Lod2Fault.Permanent, err);
  undecoded.set(url, err);
  return err;
}

/** One content tile in lng/lat/sea level; null when absent or unreachable, a rejection when it does not decode. A known failure costs no fetch. */
export function fetchLod2Tile(c: WalkContent, region: Lod2Region, wanted: () => boolean = () => true): Promise<Lod2Tile | null> {
  if (undecoded.has(c.url)) return Promise.reject(undecoded.get(c.url));
  if (faults.blocked(c.url)) return Promise.resolve(null);
  const hit = cache.get(c.url);
  if (hit) {
    touch(c.url, hit);
    return Promise.resolve(hit);
  }
  const f = inflight.get(c.url);
  if (f) {
    f.wants.push(wanted);
    return f.p;
  }
  const e: Inflight = { p: Promise.resolve(null), wants: [wanted], abort: new AbortController() };
  e.p = load(c, region, e).finally(() => {
    if (inflight.get(c.url) === e) inflight.delete(c.url);
  });
  inflight.set(c.url, e);
  return e.p;
}

/** Aborts every fetch no caller still wants; their callers get null. */
export function abandonLod2Fetches(): void {
  for (const [url, e] of inflight) {
    if (e.wants.some((w) => w())) continue;
    inflight.delete(url);
    e.abort.abort();
  }
}
