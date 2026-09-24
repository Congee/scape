/** The user-imported GSI geoid in OPFS: `geoid/grid.f32` plus a `meta.json` written after it. Worker-safe: no DOM. */

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

/** Parses and stores the grid, replacing any earlier one; the meta goes last so a torn write reads as absent. */
export async function importGeoid(file: File): Promise<GeoidMeta> {
  const { n, ...header } = parseGsiGeoid(await geoidText(file));
  const dir = await geoidDir(true);
  await dir.removeEntry(META).catch(() => undefined);
  await writeFileBytes(dir, GRID, new Uint8Array(n.buffer as ArrayBuffer));
  const meta: GeoidMeta = { ...header, fileName: file.name, importedAt: new Date().toISOString(), bytes: n.byteLength };
  await writeFileBytes(dir, META, new TextEncoder().encode(JSON.stringify(meta)));
  return meta;
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
  const file = await (await (await geoidDir(false)).getFileHandle(GRID)).getFile();
  if (file.size !== meta.rows * meta.cols * 4) return null;
  const { lat0, lng0, dLat, dLng, rows, cols, version } = meta;
  return { lat0, lng0, dLat, dLng, rows, cols, version, n: new Float32Array(await file.arrayBuffer()) };
}

export async function removeGeoid(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(DIR, { recursive: true }).catch(() => undefined);
}
