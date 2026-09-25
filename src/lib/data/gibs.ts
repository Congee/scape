/** GIBS nightly VIIRS tiles, fetched on demand and kept in OPFS: `gibs/<date>/<z>-<row>-<col>.png` (empty: no tile), `gibs/latest.json`. Worker-safe: no DOM. */

import { gibsNights, gibsTileUrl, isStale, probeDates, type GibsTile } from '@core/sky/gibs';
import { opfsSupported, writeFileBytes } from './opfs';

const DIR = 'gibs';
const LATEST = 'latest.json';

export interface GibsLatest {
  /** Newest published night, YYYY-MM-DD. */
  newest: string;
  checkedAtMs: number;
}

/** No network: the request failed before any response. */
export class GibsOfflineError extends Error {}

type DirEntries = FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> };

const root = async (): Promise<FileSystemDirectoryHandle | null> => (opfsSupported() ? (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create: true }) : null);
const fileName = (t: GibsTile) => `${t.z}-${t.row}-${t.col}.png`;

async function readFile(dir: FileSystemDirectoryHandle, name: string): Promise<Uint8Array | undefined> {
  try {
    return new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer());
  } catch {
    return undefined;
  }
}

export async function readLatest(): Promise<GibsLatest | null> {
  const dir = await root();
  const bytes = dir && (await readFile(dir, LATEST));
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as GibsLatest;
  } catch {
    return null;
  }
}

async function writeLatest(l: GibsLatest): Promise<void> {
  const dir = await root();
  if (dir) await writeFileBytes(dir, LATEST, new TextEncoder().encode(JSON.stringify(l)));
}

/** Tries per tile; GIBS answers the odd 5xx under load, as the calibration saw. */
const ATTEMPTS = 4;

/** PNG bytes, or null where GIBS has no tile (400/404). */
async function download(date: string, t: GibsTile, attempt = 0): Promise<Uint8Array | null> {
  let res: Response;
  try {
    res = await fetch(gibsTileUrl(date, t));
  } catch {
    throw new GibsOfflineError('offline');
  }
  if (res.status === 400 || res.status === 404) return null;
  if (res.ok) return new Uint8Array(await res.arrayBuffer());
  if (attempt + 1 >= ATTEMPTS) throw new Error(`GIBS HTTP ${res.status}`);
  await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  return download(date, t, attempt + 1);
}

export interface TileBytes {
  bytes: Uint8Array | null;
  /** Bytes downloaded for it; 0 from the cache. */
  fetched: number;
}

/** One night's tile, from OPFS when stored, else from GIBS and then stored. */
export async function gibsTile(date: string, t: GibsTile): Promise<TileBytes> {
  const dir = await (await root())?.getDirectoryHandle(date, { create: true });
  const cached = dir && (await readFile(dir, fileName(t)));
  if (cached) return { bytes: cached.length ? cached : null, fetched: 0 };
  const bytes = await download(date, t);
  if (dir) await store(dir, t, bytes);
  return { bytes, fetched: bytes?.length ?? 0 };
}

const store = (dir: FileSystemDirectoryHandle, t: GibsTile, bytes: Uint8Array | null) => writeFileBytes(dir, fileName(t), (bytes ?? new Uint8Array(0)) as Uint8Array<ArrayBuffer>);

/** Night directories outside the current set are dropped. */
async function prune(keep: readonly string[]): Promise<void> {
  const dir = await root();
  if (!dir) return;
  const old: string[] = [];
  for await (const [name, h] of (dir as DirEntries).entries()) if (h.kind === 'directory' && !keep.includes(name)) old.push(name);
  await Promise.all(old.map((n) => dir.removeEntry(n, { recursive: true }).catch(() => {})));
}

/**
 * The newest published night: the stored one while fresh, else probed with the point's own tile, newest date first.
 * Offline, a stale stored night still serves; without one it throws GibsOfflineError.
 */
export async function newestNight(probe: GibsTile, nowMs: number): Promise<string> {
  const latest = await readLatest();
  if (latest && !isStale(latest.checkedAtMs, nowMs)) return latest.newest;
  let hit: { date: string; bytes: Uint8Array } | null;
  try {
    hit = await firstNight(probeDates(nowMs), probe);
  } catch (e) {
    if (e instanceof GibsOfflineError && latest) return latest.newest;
    throw e;
  }
  if (!hit) throw new Error(`no GIBS night in the last ${probeDates(nowMs).length} days`);
  const dir = await (await root())?.getDirectoryHandle(hit.date, { create: true });
  if (dir) await store(dir, probe, hit.bytes);
  await writeLatest({ newest: hit.date, checkedAtMs: nowMs });
  await prune(gibsNights(hit.date));
  return hit.date;
}

/** The first date with the tile, tried in order. */
async function firstNight(dates: readonly string[], t: GibsTile): Promise<{ date: string; bytes: Uint8Array } | null> {
  if (!dates.length) return null;
  const bytes = await download(dates[0], t);
  return bytes ? { date: dates[0], bytes } : firstNight(dates.slice(1), t);
}
