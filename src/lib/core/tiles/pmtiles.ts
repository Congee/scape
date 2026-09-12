/** PMTiles v3 writer and tile-range helpers. Pure: no DOM, fetch or workers. */

import { Compression, TileType, zxyToTileId } from 'pmtiles';
import type { Entry, Header } from 'pmtiles';
import type { Bbox } from '@core/geo/bbox';
import { lngLatToTilePixel } from '@core/terrain/tiles';

export const PMTILES_HEADER_BYTES = 127;

/** The library reads the first 16 KiB to get header + root directory, so the root must fit there. */
const MAX_ROOT_BYTES = 16_384 - PMTILES_HEADER_BYTES;
const DEFAULT_LEAF_SIZE = 4096;

export type Compressor = (bytes: Uint8Array) => Promise<Uint8Array>;

export interface TileSink {
  write(bytes: Uint8Array): Promise<void> | void;
}

export interface ArchiveSpec {
  tileType: TileType;
  tileCompression: Compression;
  minZoom: number;
  maxZoom: number;
  bounds: Bbox;
  centre?: { lng: number; lat: number; zoom: number };
  metadata?: unknown;
}

export interface ByteRange {
  offset: number;
  length: number;
}

// --- gzip ---------------------------------------------------------------

const through = async (bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> => {
  const src = new ReadableStream<BufferSource>({
    start(c) {
      c.enqueue(new Uint8Array(bytes));
      c.close();
    }
  });
  const out = await new Response(src.pipeThrough(transform)).arrayBuffer();
  return new Uint8Array(out);
};

export function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return through(bytes, new CompressionStream('gzip'));
}

export function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return through(bytes, new DecompressionStream('gzip'));
}

// --- varints ------------------------------------------------------------

// Division rather than bit ops: tile ids and offsets exceed 32 bits.
const writeVarint = (out: number[], value: number): void => {
  let v = value;
  while (v >= 128) {
    out.push((v % 128) + 128);
    v = Math.floor(v / 128);
  }
  out.push(v);
};

const readVarint = (buf: Uint8Array, pos: { i: number }): number => {
  let value = 0;
  let scale = 1;
  for (;;) {
    const b = buf[pos.i++];
    value += (b & 0x7f) * scale;
    if (b < 128) return value;
    scale *= 128;
  }
};

// --- header -------------------------------------------------------------

const setUint64 = (dv: DataView, offset: number, value: number): void => {
  dv.setUint32(offset, value % 2 ** 32, true);
  dv.setUint32(offset + 4, Math.floor(value / 2 ** 32), true);
};

const setE7 = (dv: DataView, offset: number, deg: number): void => {
  dv.setInt32(offset, Math.round(deg * 1e7), true);
};

export function serializeHeader(h: Header): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(PMTILES_HEADER_BYTES);
  const dv = new DataView(bytes.buffer);
  bytes.set([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73], 0); // "PMTiles"
  dv.setUint8(7, 3);
  setUint64(dv, 8, h.rootDirectoryOffset);
  setUint64(dv, 16, h.rootDirectoryLength);
  setUint64(dv, 24, h.jsonMetadataOffset);
  setUint64(dv, 32, h.jsonMetadataLength);
  setUint64(dv, 40, h.leafDirectoryOffset);
  setUint64(dv, 48, h.leafDirectoryLength ?? 0);
  setUint64(dv, 56, h.tileDataOffset);
  setUint64(dv, 64, h.tileDataLength ?? 0);
  setUint64(dv, 72, h.numAddressedTiles);
  setUint64(dv, 80, h.numTileEntries);
  setUint64(dv, 88, h.numTileContents);
  dv.setUint8(96, h.clustered ? 1 : 0);
  dv.setUint8(97, h.internalCompression);
  dv.setUint8(98, h.tileCompression);
  dv.setUint8(99, h.tileType);
  dv.setUint8(100, h.minZoom);
  dv.setUint8(101, h.maxZoom);
  setE7(dv, 102, h.minLon);
  setE7(dv, 106, h.minLat);
  setE7(dv, 110, h.maxLon);
  setE7(dv, 114, h.maxLat);
  dv.setUint8(118, h.centerZoom);
  setE7(dv, 119, h.centerLon);
  setE7(dv, 123, h.centerLat);
  return bytes;
}

// --- directories --------------------------------------------------------

/** Merge consecutive tile ids that share one blob into runs. */
export function runLengthEncode(entries: Entry[]): Entry[] {
  const out: Entry[] = [];
  for (const e of entries) {
    const last = out.at(-1);
    if (last && last.runLength > 0 && last.tileId + last.runLength === e.tileId && last.offset === e.offset && last.length === e.length) {
      last.runLength += e.runLength;
    } else {
      out.push({ ...e });
    }
  }
  return out;
}

/** Entries must already be sorted by tileId. */
export function serializeDirectory(entries: Entry[]): Uint8Array {
  const out: number[] = [];
  writeVarint(out, entries.length);
  let prevId = 0;
  for (const e of entries) {
    writeVarint(out, e.tileId - prevId);
    prevId = e.tileId;
  }
  for (const e of entries) writeVarint(out, e.runLength);
  for (const e of entries) writeVarint(out, e.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const prev = entries[i - 1];
    writeVarint(out, prev && e.offset === prev.offset + prev.length ? 0 : e.offset + 1);
  }
  return new Uint8Array(out);
}

export function deserializeDirectory(bytes: Uint8Array): Entry[] {
  const pos = { i: 0 };
  const count = readVarint(bytes, pos);
  const entries: Entry[] = [];
  let id = 0;
  for (let i = 0; i < count; i++) {
    id += readVarint(bytes, pos);
    entries.push({ tileId: id, offset: 0, length: 0, runLength: 0 });
  }
  for (let i = 0; i < count; i++) entries[i].runLength = readVarint(bytes, pos);
  for (let i = 0; i < count; i++) entries[i].length = readVarint(bytes, pos);
  for (let i = 0; i < count; i++) {
    const v = readVarint(bytes, pos);
    entries[i].offset = v === 0 && i > 0 ? entries[i - 1].offset + entries[i - 1].length : v - 1;
  }
  return entries;
}

/**
 * One root directory when it fits `maxRootBytes`, otherwise leaves of `leafSize` entries
 * with a root of leaf pointers (`runLength: 0`, offsets relative to the leaves section).
 */
export async function buildDirectories(
  entries: Entry[],
  compress: Compressor,
  opts?: { maxRootBytes?: number; leafSize?: number }
): Promise<{ root: Uint8Array; leaves: Uint8Array; leafCount: number }> {
  const maxRootBytes = opts?.maxRootBytes ?? MAX_ROOT_BYTES;
  const flat = await compress(serializeDirectory(entries));
  if (flat.length <= maxRootBytes) return { root: flat, leaves: new Uint8Array(0), leafCount: 0 };

  let leafSize = opts?.leafSize ?? DEFAULT_LEAF_SIZE;
  for (;;) {
    const slices: Entry[][] = [];
    for (let i = 0; i < entries.length; i += leafSize) slices.push(entries.slice(i, i + leafSize));
    // oxlint-disable-next-line no-await-in-loop -- retry loop, one pass at a time
    const chunks = await Promise.all(slices.map((slice) => compress(serializeDirectory(slice))));

    const rootEntries: Entry[] = [];
    let offset = 0;
    for (const [i, leaf] of chunks.entries()) {
      rootEntries.push({ tileId: slices[i][0].tileId, offset, length: leaf.length, runLength: 0 });
      offset += leaf.length;
    }
    // oxlint-disable-next-line no-await-in-loop
    const root = await compress(serializeDirectory(rootEntries));
    if (root.length <= maxRootBytes || leafSize >= entries.length) {
      const leaves = new Uint8Array(offset);
      let at = 0;
      for (const c of chunks) {
        leaves.set(c, at);
        at += c.length;
      }
      return { root, leaves, leafCount: rootEntries.length };
    }
    leafSize *= 2;
  }
}

// --- archive ------------------------------------------------------------

/** Two FNV-1a variants plus the length: collisions are vanishingly unlikely for tile blobs. */
const contentKey = (bytes: Uint8Array): string => {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const byte of bytes) {
    a = Math.imul(a ^ byte, 0x01000193);
    b = Math.imul(b ^ byte, 0x85ebca6b);
  }
  return `${bytes.length}:${a >>> 0}:${b >>> 0}`;
};

export class ArchiveBuilder {
  private readonly entries: Entry[] = [];
  private readonly blobs = new Map<string, ByteRange>();
  private bytesWritten = 0;

  constructor(private readonly sink: TileSink) {}

  /** Appends `bytes` to the sink unless an identical blob was already stored. */
  async add(tileId: number, bytes: Uint8Array, dedupKey?: string): Promise<void> {
    const key = dedupKey ?? contentKey(bytes);
    let blob = this.blobs.get(key);
    if (!blob) {
      blob = { offset: this.bytesWritten, length: bytes.length };
      this.blobs.set(key, blob);
      await this.sink.write(bytes);
      this.bytesWritten += bytes.length;
    }
    this.entries.push({ tileId, offset: blob.offset, length: blob.length, runLength: 1 });
  }

  get count(): number {
    return this.entries.length;
  }

  get dataLength(): number {
    return this.bytesWritten;
  }

  /** Archive prefix: header, root directory, gzip'd JSON metadata, leaf directories. Tile data follows. */
  async finish(spec: ArchiveSpec, compress: Compressor = gzip, opts?: { maxRootBytes?: number; leafSize?: number }): Promise<Uint8Array> {
    const sorted = this.entries.toSorted((x, y) => x.tileId - y.tileId);
    const clustered = sorted.every((e, i) => i === 0 || e.offset >= sorted[i - 1].offset);
    const rle = runLengthEncode(sorted);
    const { root, leaves } = await buildDirectories(rle, compress, opts);
    const metadata = await compress(new TextEncoder().encode(JSON.stringify(spec.metadata ?? {})));

    const rootOffset = PMTILES_HEADER_BYTES;
    const metadataOffset = rootOffset + root.length;
    const leafOffset = metadataOffset + metadata.length;
    const tileDataOffset = leafOffset + leaves.length;
    const centre = spec.centre ?? { lng: 0, lat: 0, zoom: spec.minZoom };

    const header = serializeHeader({
      specVersion: 3,
      rootDirectoryOffset: rootOffset,
      rootDirectoryLength: root.length,
      jsonMetadataOffset: metadataOffset,
      jsonMetadataLength: metadata.length,
      leafDirectoryOffset: leafOffset,
      leafDirectoryLength: leaves.length,
      tileDataOffset,
      tileDataLength: this.bytesWritten,
      numAddressedTiles: sorted.length,
      numTileEntries: rle.length,
      numTileContents: this.blobs.size,
      clustered,
      internalCompression: Compression.Gzip,
      tileCompression: spec.tileCompression,
      tileType: spec.tileType,
      minZoom: spec.minZoom,
      maxZoom: spec.maxZoom,
      minLon: spec.bounds.west,
      minLat: spec.bounds.south,
      maxLon: spec.bounds.east,
      maxLat: spec.bounds.north,
      centerZoom: centre.zoom,
      centerLon: centre.lng,
      centerLat: centre.lat
    });

    const prefix = new Uint8Array(tileDataOffset);
    prefix.set(header, 0);
    prefix.set(root, rootOffset);
    prefix.set(metadata, metadataOffset);
    prefix.set(leaves, leafOffset);
    return prefix;
  }
}

// --- tile ranges --------------------------------------------------------

export interface TileXyRange {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Inclusive tile ranges covering `bbox` at zoom `z`; two when the box crosses the antimeridian. */
export function tileRange(bbox: Bbox, z: number): TileXyRange[] {
  const n = 2 ** z;
  const xOf = (lng: number) => Math.min(n - 1, Math.max(0, Math.floor(((lng + 180) / 360) * n)));
  const y0 = lngLatToTilePixel(0, bbox.north, z).y;
  const y1 = lngLatToTilePixel(0, bbox.south, z).y;
  const west = xOf(bbox.west);
  const east = xOf(bbox.east);
  if (bbox.west <= bbox.east) return [{ x0: west, x1: east, y0, y1 }];
  // The two halves meet: the box wraps onto itself, so cover the full width once.
  if (east >= west) return [{ x0: 0, x1: n - 1, y0, y1 }];
  return [
    { x0: west, x1: n - 1, y0, y1 },
    { x0: 0, x1: east, y0, y1 }
  ];
}

export function tileCountInBounds(bbox: Bbox, minZoom: number, maxZoom: number): number {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    for (const r of tileRange(bbox, z)) total += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  }
  return total;
}

export function tileIdsInBounds(bbox: Bbox, minZoom: number, maxZoom: number): number[] {
  const ids: number[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    for (const r of tileRange(bbox, z)) {
      for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) ids.push(zxyToTileId(z, x, y));
    }
  }
  const sorted = ids.toSorted((a, b) => a - b);
  return sorted.filter((id, i) => i === 0 || id !== sorted[i - 1]);
}

/** Merge byte ranges separated by at most `maxGap` while the chunk stays within `maxChunk`. */
export function coalesceRanges(ranges: ByteRange[], maxGap: number, maxChunk: number): Array<{ offset: number; length: number; ranges: ByteRange[] }> {
  const sorted = ranges.toSorted((a, b) => a.offset - b.offset || a.length - b.length);
  const out: Array<{ offset: number; length: number; ranges: ByteRange[] }> = [];
  for (const r of sorted) {
    const cur = out.at(-1);
    const end = r.offset + r.length;
    if (cur && r.offset - (cur.offset + cur.length) <= maxGap && end - cur.offset <= maxChunk) {
      cur.length = Math.max(cur.length, end - cur.offset);
      cur.ranges.push(r);
    } else {
      out.push({ offset: r.offset, length: r.length, ranges: [r] });
    }
  }
  return out;
}
