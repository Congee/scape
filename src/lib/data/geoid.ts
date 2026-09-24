/** The user-imported GSI geoid in OPFS: `geoid/<grid>.f32` plus a `meta.json` naming it, written after it. Worker-safe: no DOM. */

import { parseGsiGeoid, type GeoidGrid, type GeoidHeader } from '@core/geo/geoid';
import { findZipEntry, isGzip, isZip, ZipMethod } from '@core/io/zip';
import { opfsSupported, writeFileBytes } from './opfs';

const DIR = 'geoid';
const GRID = 'grid.f32';
const META = 'meta.json';

export const GEOID_DOWNLOAD_URL = 'https://www.gsi.go.jp/buturisokuchi/grageo_reference.html';

/** GSI's credit form for edited content, under its content terms. */
export const geoidCredit = (version: string): string => `「日本のジオイド2011」${version}（国土地理院）を加工して作成`;

export interface GeoidMeta extends GeoidHeader {
  fileName: string;
  /** ISO timestamp; also the key workers compare to drop tiles built on another grid. */
  importedAt: string;
  bytes: number;
  /** Grid file name; absent for grids stored before imports were swapped in. */
  grid?: string;
}

async function geoidDir(create: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create });
}

async function inflate(data: Uint8Array<ArrayBuffer>, format: CompressionFormat): Promise<Uint8Array<ArrayBuffer>> {
  const out = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream(format))).arrayBuffer();
  return new Uint8Array(out);
}

/** The .asc text from a plain, gzipped or zipped file; GSI's files are ASCII. */
export async function geoidText(file: Blob): Promise<string> {
  let b = new Uint8Array(await file.arrayBuffer());
  if (isGzip(b)) b = await inflate(b, 'gzip');
  else if (isZip(b)) {
    const e = findZipEntry(b, (n) => /\.asc$/i.test(n));
    if (!e) throw new Error('The zip holds no .asc geoid file.');
    b = e.method === ZipMethod.Stored ? e.data.slice() : await inflate(e.data.slice(), 'deflate-raw');
  }
  return new TextDecoder('latin1').decode(b);
}

/** Parses and stores the grid, replacing any earlier one only once the new one is fully written. */
export async function importGeoid(file: File): Promise<GeoidMeta> {
  const { n, ...header } = parseGsiGeoid(await geoidText(file));
  const meta: GeoidMeta & { grid: string } = { ...header, fileName: file.name, importedAt: new Date().toISOString(), bytes: n.byteLength, grid: `grid-${Date.now().toString(36)}.f32` };
  await storeGeoid(await geoidDir(true), new Uint8Array(n.buffer as ArrayBuffer), meta);
  return meta;
}

type DirEntries = FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> };

/** The grid goes to a fresh file and the meta repoints to it, so a failed write (quota) leaves the old pair readable. */
export async function storeGeoid(dir: FileSystemDirectoryHandle, grid: Uint8Array<ArrayBuffer>, meta: GeoidMeta & { grid: string }): Promise<void> {
  const old = await dir
    .getFileHandle(META)
    .then(async (h) => (await h.getFile()).text())
    .catch(() => null);
  try {
    await writeFileBytes(dir, meta.grid, grid);
    await writeFileBytes(dir, META, new TextEncoder().encode(JSON.stringify(meta)));
  } catch (err) {
    await dir.removeEntry(meta.grid).catch(() => undefined);
    if (old !== null) await writeFileBytes(dir, META, new TextEncoder().encode(old)).catch(() => undefined);
    throw err;
  }
  const stale: string[] = [];
  for await (const name of (dir as DirEntries).keys()) if (name !== META && name !== meta.grid) stale.push(name);
  await Promise.all(stale.map((name) => dir.removeEntry(name).catch(() => undefined)));
}

export async function readGeoidMeta(): Promise<GeoidMeta | null> {
  if (!opfsSupported()) return null;
  try {
    const dir = await geoidDir(false);
    return JSON.parse(await (await (await dir.getFileHandle(META)).getFile()).text()) as GeoidMeta;
  } catch {
    return null;
  }
}

/** The stored grid; null when none is imported or the stored one does not match its meta. */
export async function readGeoid(): Promise<GeoidGrid | null> {
  const meta = await readGeoidMeta();
  if (!meta) return null;
  const file = await (await (await geoidDir(false)).getFileHandle(meta.grid ?? GRID)).getFile();
  if (file.size !== meta.rows * meta.cols * 4) return null;
  const { lat0, lng0, dLat, dLng, rows, cols, version } = meta;
  return { lat0, lng0, dLat, dLng, rows, cols, version, n: new Float32Array(await file.arrayBuffer()) };
}

export async function removeGeoid(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(DIR, { recursive: true }).catch(() => undefined);
}
