/** Offline archives in OPFS: `<id>.pmtiles` plus an `<id>.json` sidecar. Worker-safe: no DOM. */

import { bytesToHeader, TileType, type Header, type RangeResponse, type Source } from 'pmtiles';
import { ArchiveKind, type ArchiveMeta } from '@workers/region.protocol';

const DIR = 'archives';
const HEADER_BYTES = 127;

export const ARCHIVES_CHANNEL = 'scape.archives';

export const archiveName = (id: string): string => `${id}.pmtiles`;
export const archiveKey = (id: string): string => `opfs/${archiveName(id)}`;

export function opfsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

export async function archivesDir(create = true): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create });
}

/** OPFS handles expose async iterators the DOM lib does not always type. */
type DirEntries = FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> };

async function fileNames(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  for await (const name of (dir as DirEntries).keys()) names.push(name);
  return names;
}

export async function readArchiveFile(id: string): Promise<File> {
  const dir = await archivesDir();
  return (await dir.getFileHandle(archiveName(id))).getFile();
}

export function metaFromHeader(id: string, name: string, header: Header, bytes: number, sourceUrl: string): ArchiveMeta {
  return {
    id,
    name,
    kind: header.tileType === TileType.Mvt ? ArchiveKind.Basemap : ArchiveKind.Terrain,
    bbox: { west: header.minLon, south: header.minLat, east: header.maxLon, north: header.maxLat },
    minZoom: header.minZoom,
    maxZoom: header.maxZoom,
    bytes,
    tileCount: header.numAddressedTiles,
    sourceUrl,
    downloadedAt: new Date().toISOString()
  };
}

export async function readHeader(file: Blob): Promise<Header> {
  return bytesToHeader(await file.slice(0, HEADER_BYTES).arrayBuffer());
}

/** The directory is the source of truth; a missing sidecar is rebuilt from the PMTiles header. */
export async function listArchives(): Promise<ArchiveMeta[]> {
  if (!opfsSupported()) return [];
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await archivesDir();
  } catch {
    return [];
  }
  const names = await fileNames(dir);
  const ids = names.filter((n) => n.endsWith('.pmtiles')).map((n) => n.slice(0, -'.pmtiles'.length));
  const metas = await Promise.all(
    ids.map(async (id): Promise<ArchiveMeta | null> => {
      try {
        const file = await (await dir.getFileHandle(archiveName(id))).getFile();
        if (names.includes(`${id}.json`)) {
          const text = await (await (await dir.getFileHandle(`${id}.json`)).getFile()).text();
          const meta = JSON.parse(text) as ArchiveMeta;
          meta.bytes = file.size;
          return meta;
        }
        return metaFromHeader(id, id, await readHeader(file), file.size, '');
      } catch {
        return null;
      }
    })
  );
  return metas.filter((m): m is ArchiveMeta => m !== null).toSorted((a, b) => a.downloadedAt.localeCompare(b.downloadedAt));
}

/** Prefers the worker-only sync handle; Safari has no main-thread `createWritable`. */
export async function writeFileBytes(dir: FileSystemDirectoryHandle, name: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  if (typeof handle.createSyncAccessHandle === 'function') {
    const sync = await handle.createSyncAccessHandle();
    try {
      sync.truncate(0);
      sync.write(bytes, { at: 0 });
      sync.flush();
    } finally {
      sync.close();
    }
    return;
  }
  const writable = await handle.createWritable();
  await writable.write(bytes);
  await writable.close();
}

export async function writeMeta(meta: ArchiveMeta): Promise<void> {
  const dir = await archivesDir();
  await writeFileBytes(dir, `${meta.id}.json`, new TextEncoder().encode(JSON.stringify(meta)));
}

export async function removeArchive(id: string): Promise<void> {
  const dir = await archivesDir();
  for (const name of [archiveName(id), `${id}.json`]) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- two entries, order irrelevant
      await dir.removeEntry(name);
    } catch {
      // already gone
    }
  }
}

/** Tells workers and other tabs to re-list the directory. */
export function announceArchives(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const ch = new BroadcastChannel(ARCHIVES_CHANNEL);
  ch.postMessage('changed');
  ch.close();
}

/** Reads an OPFS archive through one `File` snapshot, so range reads are plain slices. */
export class OpfsSource implements Source {
  private file: Promise<File> | null = null;

  constructor(private readonly id: string) {}

  getKey(): string {
    return archiveKey(this.id);
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    this.file ??= readArchiveFile(this.id);
    const file = await this.file;
    return { data: await file.slice(offset, offset + length).arrayBuffer() };
  }
}
