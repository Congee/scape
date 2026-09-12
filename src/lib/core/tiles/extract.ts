/** Planning a sub-extract of a remote PMTiles archive. Pure: the directory reader is injected. */

import { findTile } from 'pmtiles';
import type { Entry, Header } from 'pmtiles';
import type { Bbox } from '@core/geo/bbox';
import { tileIdsInBounds } from './pmtiles';
import type { ByteRange } from './pmtiles';

/** `getDirectory` takes absolute file offsets; callers add `header.leafDirectoryOffset` for leaves. */
export interface DirectoryReader {
  header: Header;
  getDirectory(offset: number, length: number): Promise<Entry[]>;
}

export interface ExtractPlan {
  /** `offset` is relative to `header.tileDataOffset`, as stored in the directory. */
  tiles: Array<{ tileId: number; offset: number; length: number }>;
  /** Unique absolute file ranges to fetch, sorted by offset. */
  ranges: ByteRange[];
  totalBytes: number;
  tileCount: number;
  minZoom: number;
  maxZoom: number;
}

const MAX_DEPTH = 4;

export async function planExtract(reader: DirectoryReader, bbox: Bbox, minZoom: number, maxZoom: number): Promise<ExtractPlan> {
  const { header } = reader;
  const minZ = Math.max(minZoom, header.minZoom);
  const maxZ = Math.min(maxZoom, header.maxZoom);
  const tiles: ExtractPlan['tiles'] = [];
  const seen = new Map<string, ByteRange>();

  if (minZ <= maxZ) {
    const wanted = tileIdsInBounds(bbox, minZ, maxZ);
    const root = await reader.getDirectory(header.rootDirectoryOffset, header.rootDirectoryLength);
    await resolve(reader, root, wanted, 0, tiles, seen);
  }

  const ranges = [...seen.values()].toSorted((a, b) => a.offset - b.offset);
  return {
    tiles,
    ranges,
    totalBytes: ranges.reduce((sum, r) => sum + r.length, 0),
    tileCount: tiles.length,
    minZoom: minZ,
    maxZoom: maxZ
  };
}

async function resolve(
  reader: DirectoryReader,
  dir: Entry[],
  wanted: number[],
  depth: number,
  tiles: ExtractPlan['tiles'],
  seen: Map<string, ByteRange>
): Promise<void> {
  if (depth > MAX_DEPTH) throw new Error('Maximum PMTiles directory depth exceeded');
  const leaves = new Map<Entry, number[]>();
  for (const tileId of wanted) {
    const e = findTile(dir, tileId);
    if (!e) continue;
    if (e.runLength > 0) {
      tiles.push({ tileId, offset: e.offset, length: e.length });
      const key = `${e.offset}:${e.length}`;
      if (!seen.has(key)) seen.set(key, { offset: reader.header.tileDataOffset + e.offset, length: e.length });
    } else {
      const ids = leaves.get(e);
      if (ids) ids.push(tileId);
      else leaves.set(e, [tileId]);
    }
  }
  // Leaves are read in tileId order so `tiles` and `seen` stay ordered.
  for (const [leaf, ids] of leaves) {
    // oxlint-disable-next-line no-await-in-loop
    const dirEntries = await reader.getDirectory(reader.header.leafDirectoryOffset + leaf.offset, leaf.length);
    // oxlint-disable-next-line no-await-in-loop
    await resolve(reader, dirEntries, ids, depth + 1, tiles, seen);
  }
}
