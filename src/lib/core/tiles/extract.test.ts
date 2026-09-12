import { Compression, PMTiles, SharedPromiseCache, TileType, tileIdToZxy } from 'pmtiles';
import type { Source } from 'pmtiles';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Bbox } from '@core/geo/bbox';
import { planExtract } from './extract';
import type { DirectoryReader } from './extract';
import { ArchiveBuilder, gzip, tileIdsInBounds } from './pmtiles';
import type { TileSink } from './pmtiles';

const EUROPE: Bbox = { west: -10, south: 35, east: 30, north: 60 };
const ALPS: Bbox = { west: 6, south: 45, east: 9, north: 47 };
const NEW_ZEALAND: Bbox = { west: 166, south: -47, east: 179, north: -34 };

/** Every 5th tile shares one blob, so ranges and totals have to deduplicate. */
const payload = (z: number, x: number, y: number): Uint8Array => new TextEncoder().encode((x + y) % 5 === 0 ? 'shared' : `tile ${z}/${x}/${y}`);

class MemorySink implements TileSink {
  readonly chunks: Uint8Array[] = [];
  write(bytes: Uint8Array): void {
    this.chunks.push(bytes);
  }
}

let reader: DirectoryReader;

beforeAll(async () => {
  const sink = new MemorySink();
  const builder = new ArchiveBuilder(sink);
  for (const id of tileIdsInBounds(EUROPE, 0, 9)) {
    const [z, x, y] = tileIdToZxy(id);
    // oxlint-disable-next-line no-await-in-loop
    await builder.add(id, payload(z, x, y));
  }
  // A small root forces leaf directories, so planExtract has to descend.
  const prefix = await builder.finish(
    { tileType: TileType.Png, tileCompression: Compression.None, minZoom: 0, maxZoom: 9, bounds: EUROPE },
    gzip,
    { maxRootBytes: 600, leafSize: 256 }
  );
  const bytes = new Uint8Array(prefix.length + builder.dataLength);
  bytes.set(prefix, 0);
  let at = prefix.length;
  for (const c of sink.chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  const source: Source = {
    getBytes: (offset: number, length: number) => Promise.resolve({ data: bytes.slice(offset, offset + length).buffer }),
    getKey: () => 'memory'
  };
  const cache = new SharedPromiseCache();
  const header = await new PMTiles(source, cache).getHeader();
  expect(header.leafDirectoryLength).toBeGreaterThan(0);
  reader = { header, getDirectory: (offset, length) => cache.getDirectory(source, offset, length, header) };
});

describe('planExtract', () => {
  it('returns exactly the tiles intersecting the sub-bbox', async () => {
    const plan = await planExtract(reader, ALPS, 3, 8);
    const expected = tileIdsInBounds(ALPS, 3, 8);
    expect(plan.tiles.map((t) => t.tileId).toSorted((a, b) => a - b)).toEqual(expected);
    expect(plan.tileCount).toBe(expected.length);
  });

  it('totals deduplicated source bytes', async () => {
    const plan = await planExtract(reader, ALPS, 3, 8);
    const blobs = new Set<string>();
    for (const id of tileIdsInBounds(ALPS, 3, 8)) {
      const [z, x, y] = tileIdToZxy(id);
      blobs.add(new TextDecoder().decode(payload(z, x, y)));
    }
    const expectedBytes = [...blobs].reduce((n, s) => n + s.length, 0);
    expect(plan.totalBytes).toBe(expectedBytes);
    expect(plan.ranges).toHaveLength(blobs.size);
    expect(plan.ranges.map((r) => r.offset)).toEqual(plan.ranges.toSorted((a, b) => a.offset - b.offset).map((r) => r.offset));
    expect(plan.ranges.every((r) => r.offset >= reader.header.tileDataOffset)).toBe(true);
  });

  it('clamps the zoom span to the archive', async () => {
    const plan = await planExtract(reader, ALPS, 0, 20);
    expect(plan.minZoom).toBe(0);
    expect(plan.maxZoom).toBe(9);
    expect(plan.tileCount).toBe(tileIdsInBounds(ALPS, 0, 9).length);
  });

  it('skips tiles the archive does not hold', async () => {
    const plan = await planExtract(reader, NEW_ZEALAND, 6, 8);
    expect(plan.tiles).toEqual([]);
    expect(plan.totalBytes).toBe(0);
  });
});
