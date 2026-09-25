/** User-imported VNP46A4 tiles in OPFS: `viirs/<year>/<hXXvYY>.u16` counts, plus the year's LAADS `listing.json`. Worker-safe: no DOM. */

import { blobSource } from '@core/io/hdf5';
import { laadsListingUrl, parseViirsName, tileName, tilesForWindow, VIIRS_COLS, VIIRS_TILE_PX, type TileId, type ViirsWindow } from '@core/sky/viirs';
import { decodeViirsTile } from '@core/sky/viirsTile';
import { opfsSupported, writeFileBytes } from './opfs';

const DIR = 'viirs';
const LISTING = 'listing.json';
const TILE_BYTES = VIIRS_TILE_PX * VIIRS_TILE_PX * 2;

export interface ViirsTileMeta {
  year: number;
  tile: string;
  bytes: number;
}

export interface ViirsStore {
  tiles: ViirsTileMeta[];
  /** Per year, the tiles LAADS publishes; absent until fetched. Tiles outside it are open ocean or ice. */
  listings: Record<number, string[]>;
}

type DirEntries = FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> };

async function viirsDir(create: boolean): Promise<FileSystemDirectoryHandle> {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create });
}

const yearDir = async (year: number, create: boolean) => (await viirsDir(create)).getDirectoryHandle(String(year), { create });

/** Decodes an .h5 tile and stores its counts; the file name must be LAADS's own. */
export async function importViirs(file: File): Promise<ViirsTileMeta> {
  const t = await decodeViirsTile(blobSource(file), file.name);
  await writeFileBytes(await yearDir(t.year, true), `${tileName(t.tile)}.u16`, new Uint8Array(t.counts.buffer as ArrayBuffer));
  return { year: t.year, tile: tileName(t.tile), bytes: t.counts.byteLength };
}

export async function listViirs(): Promise<ViirsStore> {
  const out: ViirsStore = { tiles: [], listings: {} };
  if (!opfsSupported()) return out;
  let root: FileSystemDirectoryHandle;
  try {
    root = await viirsDir(false);
  } catch {
    return out;
  }
  for await (const [name, h] of (root as DirEntries).entries()) {
    const year = Number(name);
    if (h.kind !== 'directory' || !Number.isInteger(year)) continue;
    for await (const [f, fh] of (h as DirEntries).entries()) {
      if (fh.kind !== 'file') continue;
      const file = await (fh as FileSystemFileHandle).getFile();
      if (f === LISTING) out.listings[year] = JSON.parse(await file.text()) as string[];
      else if (/^h\d\dv\d\d\.u16$/.test(f) && file.size === TILE_BYTES) out.tiles.push({ year, tile: f.slice(0, 6), bytes: file.size });
    }
  }
  out.tiles.sort((a, b) => a.year - b.year || a.tile.localeCompare(b.tile));
  return out;
}

/** Tile names in a LAADS directory listing (`{content: [{name}]}`). */
export function parseListing(json: unknown): string[] {
  const content = (json as { content?: { name?: unknown }[] } | null)?.content;
  if (!Array.isArray(content)) throw new Error('LAADS listing has no content.');
  const names = new Set<string>();
  for (const c of content) {
    const id = typeof c?.name === 'string' ? parseViirsName(c.name) : null;
    if (id) names.add(tileName(id.tile));
  }
  return [...names].sort();
}

/** Fetches and stores a year's tile listing; keyless and CORS-open. */
export async function fetchViirsListing(year: number, signal?: AbortSignal): Promise<{ tiles: string[]; files: string[] }> {
  const res = await fetch(laadsListingUrl(year), { signal });
  if (!res.ok) throw new Error(`LAADS listing for ${year}: HTTP ${res.status}`);
  const json = (await res.json()) as { content?: { name?: string }[] };
  const tiles = parseListing(json);
  const files = (json.content ?? []).map((c) => c.name ?? '').filter((n) => parseViirsName(n));
  await writeFileBytes(await yearDir(year, true), LISTING, new TextEncoder().encode(JSON.stringify(tiles)));
  return { tiles, files };
}

export async function removeViirs(year?: number): Promise<void> {
  const root = await viirsDir(false).catch(() => null);
  if (!root) return;
  if (year === undefined) await (await navigator.storage.getDirectory()).removeEntry(DIR, { recursive: true }).catch(() => undefined);
  else await root.removeEntry(String(year), { recursive: true }).catch(() => undefined);
}

/** Reads rows [r0, r1) of one stored tile; null when the tile is not stored. */
export type TileRows = (tile: TileId, r0: number, r1: number) => Promise<Uint16Array | null>;

/** A window assembled from tiles; tiles `rows` cannot supply stay 0 and are reported. */
export async function fillWindow(w: Omit<ViirsWindow, 'data'>, rows: TileRows): Promise<{ win: ViirsWindow; absent: TileId[] }> {
  const data = new Uint16Array(w.rows * w.cols);
  const absent: TileId[] = [];
  await Promise.all(
    tilesForWindow(w).map(async (t) => {
      const tr0 = Math.max(w.row0, t.v * VIIRS_TILE_PX);
      const tr1 = Math.min(w.row0 + w.rows, (t.v + 1) * VIIRS_TILE_PX);
      const band = await rows(t, tr0 - t.v * VIIRS_TILE_PX, tr1 - t.v * VIIRS_TILE_PX);
      if (!band) {
        absent.push(t);
        return;
      }
      for (let c = 0; c < w.cols; c++) {
        const gc = (((w.col0 + c) % VIIRS_COLS) + VIIRS_COLS) % VIIRS_COLS;
        if (Math.floor(gc / VIIRS_TILE_PX) !== t.h) continue;
        const tc = gc % VIIRS_TILE_PX;
        for (let r = tr0; r < tr1; r++) data[(r - w.row0) * w.cols + c] = band[(r - tr0) * VIIRS_TILE_PX + tc];
      }
    })
  );
  absent.sort((a, b) => a.v - b.v || a.h - b.h);
  return { win: { ...w, data }, absent };
}

const opfsRows =
  (year: number): TileRows =>
  async (t, r0, r1) => {
    try {
      const file = await (await (await yearDir(year, false)).getFileHandle(`${tileName(t)}.u16`)).getFile();
      if (file.size !== TILE_BYTES) return null;
      return new Uint16Array(await file.slice(r0 * VIIRS_TILE_PX * 2, r1 * VIIRS_TILE_PX * 2).arrayBuffer());
    } catch {
      return null;
    }
  };

export const readViirsWindow = (year: number, w: Omit<ViirsWindow, 'data'>) => fillWindow(w, opfsRows(year));
