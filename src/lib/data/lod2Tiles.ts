import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { isB3dm, readB3dm } from '@core/lod2/b3dm';
import { lod2Tile, type Lod2Tile } from '@core/lod2/tile';
import { walkTileset, type TilesetJson, type WalkContent, type WalkView } from '@core/lod2/tileset';
import type { Lod2Region } from '@core/lod2/regions';
import { gltfUsesDraco, readGlbWorld, type DracoDecoder } from '@core/model/gltf';

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
/** A tileset that failed is retried on the next walk, not within this one. */
const failed = new Set<string>();

function loadTileset(url: string): Promise<void> {
  let p = tilesetInflight.get(url);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status}`);
        tilesets.set(url, (await res.json()) as TilesetJson);
      } catch {
        failed.add(url);
      }
    })().finally(() => tilesetInflight.delete(url));
    tilesetInflight.set(url, p);
  }
  return p;
}

/** Contents the view needs, nearest first, after fetching every external tileset the walk reaches. */
export async function walkRegion(region: Lod2Region, view: WalkView): Promise<WalkContent[]> {
  failed.clear();
  for (let round = 0; ; round++) {
    const r = walkTileset(region.tileset, (u) => tilesets.get(u), view);
    const todo = r.pending.filter((u) => !failed.has(u));
    if (todo.length === 0 || round === WALK_ROUNDS) return r.contents;
    // oxlint-disable-next-line no-await-in-loop -- each round's tilesets name the next ones
    await Promise.all(todo.map(loadTileset));
  }
}

const cache = new Map<string, Lod2Tile>();
const inflight = new Map<string, Promise<Lod2Tile | null>>();
const waiting: (() => void)[] = [];
let active = 0;

function touch(key: string, t: Lod2Tile): void {
  cache.delete(key);
  cache.set(key, t);
  while (cache.size > maxCachedTiles) cache.delete(cache.keys().next().value!);
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

async function load(c: WalkContent, region: Lod2Region): Promise<Lod2Tile | null> {
  await acquire();
  let buf: ArrayBuffer;
  try {
    const res = await fetch(c.url);
    if (!res.ok) return null;
    buf = await res.arrayBuffer();
  } catch {
    return null;
  } finally {
    release();
  }
  const b = isB3dm(buf) ? readB3dm(buf) : { glb: buf, rtc: undefined, batch: {} };
  await MeshoptDecoder.ready;
  const w = readGlbWorld(b.glb, { meshopt: MeshoptDecoder, draco: gltfUsesDraco(b.glb) ? await dracoDecoder() : undefined });
  w.rtc ??= b.rtc;
  const t = lod2Tile(w, c.transform, region, b.batch);
  touch(c.url, t);
  return t;
}

/** One content tile in lng/lat/sea level; null when the network fails, a rejection when the content does not decode. */
export function fetchLod2Tile(c: WalkContent, region: Lod2Region): Promise<Lod2Tile | null> {
  const hit = cache.get(c.url);
  if (hit) {
    touch(c.url, hit);
    return Promise.resolve(hit);
  }
  let p = inflight.get(c.url);
  if (!p) {
    p = load(c, region).finally(() => inflight.delete(c.url));
    inflight.set(c.url, p);
  }
  return p;
}
