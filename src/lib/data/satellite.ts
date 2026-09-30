import { addProtocol, type RasterSourceSpecification } from 'maplibre-gl';
import {
  CachePolicy,
  Coverage,
  candidates,
  DONE_AT,
  detailOf,
  fillBlank,
  lacksDetail,
  nativeTile,
  SAT_MAX_ZOOM,
  SatKey,
  type SatKeys,
  type SatSource,
  sourceTileUrl,
  tileCoverage,
  whiteRun
} from '@core/tiles/satellite';
import { localSatellite } from './localTiles';
import { asImage, cut, fillMasks, imageType, pixels, SAT_PX } from './satelliteImage';

const TEMPLATE = 'scape-sat://{z}/{x}/{y}';
const PX = SAT_PX;
/** Parent tiles shared by several map tiles (512 px MapTiler, overzoom). */
const SHARED_MAX = 64;

/** Keys from the build env; a missing key hides that source. */
export function satKeys(): SatKeys {
  const env = import.meta.env as Record<string, string | undefined>;
  return { [SatKey.MapTiler]: env.VITE_MAPTILER_KEY || undefined, [SatKey.Esri]: env.VITE_ESRI_KEY || undefined };
}

interface Native {
  status: number;
  bytes: number;
  bitmap: ImageBitmap | null;
}

const shared = new Map<string, Promise<Native>>();

interface SatDebug {
  fetches: number;
  tiles: Record<string, string[]>;
  /** Per tile: thickest white area in px, and mean luminance step. */
  stats: Record<string, { white: number; detail: number }>;
}
const debug: SatDebug | null = import.meta.env.DEV ? { fetches: 0, tiles: {}, stats: {} } : null;
// main.tsx replaces `__scape` after this module loads, so re-attach on use.
function expose(): void {
  const w = window as unknown as { __scape?: Record<string, unknown> };
  w.__scape ??= {};
  w.__scape.satellite ??= debug;
}

async function load(url: string, noStore: boolean, signal?: AbortSignal): Promise<Native> {
  if (debug) {
    expose();
    debug.fetches++;
  }
  const res = await fetch(url, { signal, mode: 'cors', cache: noStore ? 'no-store' : 'default' }).catch(() => null);
  if (!res?.ok) return { status: res?.status ?? 0, bytes: 0, bitmap: null };
  const blob = await asImage(await res.blob().catch(() => null));
  if (!blob) return { status: res.status, bytes: 0, bitmap: null };
  return { status: res.status, bytes: blob.size, bitmap: await createImageBitmap(blob).catch(() => null) };
}

function loadShared(url: string, noStore: boolean): Promise<Native> {
  const hit = shared.get(url);
  if (hit) {
    shared.delete(url);
    shared.set(url, hit);
    return hit;
  }
  const p = load(url, noStore);
  shared.set(url, p);
  if (shared.size > SHARED_MAX) shared.delete(shared.keys().next().value as string);
  // A failed parent is retried by the next tile.
  void p.then((n) => n.bitmap || shared.get(url) !== p || shared.delete(url));
  return p;
}

async function sourceTile(s: SatSource, z: number, x: number, y: number, keys: SatKeys, signal: AbortSignal): Promise<{ native: Native; bmp: ImageBitmap | null }> {
  const nt = nativeTile(s, z, x, y);
  const url = sourceTileUrl(s, nt.z, nt.x, nt.y, keys);
  const noStore = s.cache === CachePolicy.None;
  const native = nt.n > 1 ? await loadShared(url, noStore) : await load(url, noStore, signal);
  return { native, bmp: native.bitmap ? await cut(native.bitmap, nt) : null };
}

const clearFill = fillMasks(async (s, z, x, y) => {
  const nt = nativeTile(s, z, x, y);
  const { bitmap } = await load(sourceTileUrl(s, nt.z, nt.x, nt.y), s.cache === CachePolicy.None);
  if (!bitmap) return null;
  const bmp = await cut(bitmap, nt);
  const rgba = bmp ? pixels(bmp) : null;
  if (bmp && bmp !== bitmap) bmp.close();
  bitmap.close();
  return rgba;
});

/** One map tile: the best source's cell, or a composite down the candidate list where the best is partly blank. */
export async function satelliteTile(z: number, x: number, y: number, signal: AbortSignal, keys = satKeys()): Promise<ImageBitmap | null> {
  const list = candidates(z, x, y, { keys, online: navigator.onLine });
  const used: string[] = [];
  let out: Uint8ClampedArray | null = null;
  let weak: ImageBitmap | null = null;
  const local = await localSatellite.tile(z, x, y);
  const localBmp = local ? await createImageBitmap(new Blob([local], { type: imageType(local) })).catch(() => null) : null;
  // A downloaded tile may be partly transparent at a border; the network fills the rest.
  if (localBmp) {
    const rgba = pixels(localBmp);
    const cov = tileCoverage(rgba, {});
    used.push('local');
    if (cov === Coverage.Full) {
      record(z, x, y, used, rgba);
      return localBmp;
    }
    out = new Uint8ClampedArray(PX * PX * 4);
    fillBlank(out, rgba);
  }
  for (let i = 0; i < list.length; i++) {
    const s = list[i].source;
    if (signal.aborted) return null;
    // oxlint-disable-next-line no-await-in-loop -- each source is fetched only where the ones above left blanks
    const { native, bmp } = await sourceTile(s, z, x, y, keys, signal);
    if (!bmp) continue;
    if (s.id === SatKey.MapTiler && list.slice(i + 1).some((c) => !c.overzoom) && lacksDetail(native.status, native.bytes, s.tilePx, z)) {
      weak = bmp;
      continue;
    }
    const rgba = pixels(bmp);
    // oxlint-disable-next-line no-await-in-loop -- the mask is fetched only for a tile with white in it
    const cleared = await clearFill(s, z, x, y, rgba);
    const cov = tileCoverage(rgba, s);
    if (cov === Coverage.Empty) continue;
    used.push(s.id);
    if (cov === Coverage.Full && !out && !cleared) {
      record(z, x, y, used, rgba);
      return bmp;
    }
    out ??= new Uint8ClampedArray(PX * PX * 4);
    if (fillBlank(out, rgba) / (PX * PX) <= DONE_AT) break;
  }
  if (weak) {
    used.push(`${SatKey.MapTiler}(weak)`);
    if (!out) {
      record(z, x, y, used, debug && pixels(weak));
      return weak;
    }
    fillBlank(out, pixels(weak));
  }
  if (signal.aborted) return null;
  record(z, x, y, used, out);
  return out ? createImageBitmap(new ImageData(out as Uint8ClampedArray<ArrayBuffer>, PX, PX)) : null;
}

function record(z: number, x: number, y: number, ids: string[], rgba: Uint8ClampedArray | null): void {
  if (!debug) return;
  expose();
  if (Object.keys(debug.tiles).length > 2000) {
    debug.tiles = {};
    debug.stats = {};
  }
  debug.tiles[`${z}/${x}/${y}`] = ids;
  if (rgba) debug.stats[`${z}/${x}/${y}`] = { white: whiteRun(rgba), detail: detailOf(rgba) };
}

let registered = false;

/** Registers `scape-sat://{z}/{x}/{y}` once; a tile no source covers is transparent, never an error. */
export function ensureSatelliteProtocol(): void {
  if (registered) return;
  registered = true;
  addProtocol('scape-sat', async (params, abortController) => {
    const m = /scape-sat:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    const bmp = m ? await satelliteTile(+m[1], +m[2], +m[3], abortController.signal).catch(() => null) : null;
    return { data: bmp ?? new ArrayBuffer(0) };
  });
}

export function satelliteSource(): RasterSourceSpecification {
  ensureSatelliteProtocol();
  return { type: 'raster', tiles: [TEMPLATE], tileSize: PX, minzoom: 0, maxzoom: SAT_MAX_ZOOM };
}
