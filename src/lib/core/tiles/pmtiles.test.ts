import { Compression, PMTiles, SharedPromiseCache, TileType, bytesToHeader, tileIdToZxy, zxyToTileId } from 'pmtiles';
import type { Entry, Header, Source } from 'pmtiles';
import { describe, expect, it } from 'vitest';
import type { Bbox } from '@core/geo/bbox';
import {
  ArchiveBuilder,
  PMTILES_HEADER_BYTES,
  coalesceRanges,
  deserializeDirectory,
  gzip,
  runLengthEncode,
  serializeDirectory,
  serializeHeader,
  tileCountInBounds,
  tileIdsInBounds,
  tileRange
} from './pmtiles';
import type { TileSink } from './pmtiles';

const memorySource = (buf: Uint8Array): Source => ({
  getBytes: (offset: number, length: number) => Promise.resolve({ data: buf.slice(offset, offset + length).buffer }),
  getKey: () => 'memory'
});

class MemorySink implements TileSink {
  readonly chunks: Uint8Array[] = [];
  write(bytes: Uint8Array): void {
    this.chunks.push(bytes);
  }
}

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const EUROPE: Bbox = { west: -10, south: 35, east: 30, north: 60 };

const expectAllReadable = async (archive: PMTiles, ids: number[]): Promise<void> => {
  await Promise.all(
    ids.map(async (id) => {
      const [z, x, y] = tileIdToZxy(id);
      const got = await archive.getZxy(z, x, y);
      expect(new Uint8Array(got!.data)).toEqual(payload(z, x, y));
    })
  );
};

/** Tile payload; every 7th tile repeats one blob so dedupe has something to find. */
const payload = (z: number, x: number, y: number): Uint8Array =>
  (x + y) % 7 === 0 ? new TextEncoder().encode('shared') : new TextEncoder().encode(`tile ${z}/${x}/${y}`);

async function buildArchive(
  bbox: Bbox,
  minZoom: number,
  maxZoom: number,
  opts?: { maxRootBytes?: number; leafSize?: number; body?: (z: number, x: number, y: number) => Uint8Array }
): Promise<{ bytes: Uint8Array; source: Source; ids: number[]; builder: ArchiveBuilder }> {
  const body = opts?.body ?? payload;
  const sink = new MemorySink();
  const builder = new ArchiveBuilder(sink);
  const ids = tileIdsInBounds(bbox, minZoom, maxZoom);
  for (const id of ids) {
    const [z, x, y] = tileIdToZxy(id);
    // oxlint-disable-next-line no-await-in-loop
    await builder.add(id, body(z, x, y));
  }
  const prefix = await builder.finish(
    { tileType: TileType.Png, tileCompression: Compression.None, minZoom, maxZoom, bounds: bbox },
    gzip,
    opts
  );
  const bytes = concat([prefix, ...sink.chunks]);
  return { bytes, source: memorySource(bytes), ids, builder };
}

describe('serializeHeader', () => {
  it('round-trips through the library reader', () => {
    const header: Header = {
      specVersion: 3,
      rootDirectoryOffset: PMTILES_HEADER_BYTES,
      rootDirectoryLength: 300,
      jsonMetadataOffset: 427,
      jsonMetadataLength: 20,
      leafDirectoryOffset: 447,
      leafDirectoryLength: 512,
      tileDataOffset: 959,
      tileDataLength: 2 ** 33,
      numAddressedTiles: 5_000_000_000,
      numTileEntries: 4321,
      numTileContents: 1234,
      clustered: true,
      internalCompression: Compression.Gzip,
      tileCompression: Compression.None,
      tileType: TileType.Png,
      minZoom: 3,
      maxZoom: 12,
      minLon: -10.5,
      minLat: 35.25,
      maxLon: 30.125,
      maxLat: 60,
      centerZoom: 8,
      centerLon: 9.875,
      centerLat: 47.5
    };
    const bytes = serializeHeader(header);
    expect(bytes.length).toBe(PMTILES_HEADER_BYTES);
    expect(bytesToHeader(bytes.buffer)).toEqual(header);
  });
});

describe('directories', () => {
  const entries: Entry[] = [
    { tileId: 0, offset: 0, length: 10, runLength: 1 },
    { tileId: 1, offset: 10, length: 20, runLength: 3 },
    { tileId: 4, offset: 5000, length: 7, runLength: 1 },
    { tileId: 900, offset: 10, length: 20, runLength: 1 }
  ];

  it('round-trips through deserializeDirectory', () => {
    expect(deserializeDirectory(serializeDirectory(entries))).toEqual(entries);
  });

  it('round-trips through the library directory cache', async () => {
    const dir = await gzip(serializeDirectory(entries));
    const header = bytesToHeader(serializeHeader({ ...blankHeader, rootDirectoryLength: dir.length }).buffer);
    const read = await new SharedPromiseCache().getDirectory(memorySource(dir), 0, dir.length, header);
    expect(read).toEqual(entries);
  });

  it('merges consecutive ids sharing a blob into runs', () => {
    const flat: Entry[] = [
      { tileId: 1, offset: 0, length: 4, runLength: 1 },
      { tileId: 2, offset: 0, length: 4, runLength: 1 },
      { tileId: 3, offset: 0, length: 4, runLength: 1 },
      { tileId: 4, offset: 4, length: 4, runLength: 1 },
      { tileId: 9, offset: 0, length: 4, runLength: 1 }
    ];
    expect(runLengthEncode(flat)).toEqual([
      { tileId: 1, offset: 0, length: 4, runLength: 3 },
      { tileId: 4, offset: 4, length: 4, runLength: 1 },
      { tileId: 9, offset: 0, length: 4, runLength: 1 }
    ]);
  });
});

const blankHeader: Header = {
  specVersion: 3,
  rootDirectoryOffset: PMTILES_HEADER_BYTES,
  rootDirectoryLength: 0,
  jsonMetadataOffset: 0,
  jsonMetadataLength: 0,
  leafDirectoryOffset: 0,
  leafDirectoryLength: 0,
  tileDataOffset: 0,
  tileDataLength: 0,
  numAddressedTiles: 0,
  numTileEntries: 0,
  numTileContents: 0,
  clustered: true,
  internalCompression: Compression.Gzip,
  tileCompression: Compression.None,
  tileType: TileType.Png,
  minZoom: 0,
  maxZoom: 0,
  minLon: 0,
  minLat: 0,
  maxLon: 0,
  maxLat: 0,
  centerZoom: 0,
  centerLon: 0,
  centerLat: 0
};

describe('ArchiveBuilder', () => {
  it('writes an archive the library reads back byte-exact', async () => {
    const { source, ids } = await buildArchive(EUROPE, 0, 9);
    expect(ids.length).toBeGreaterThan(2000);

    const archive = new PMTiles(source);
    const header = await archive.getHeader();
    expect(header.numAddressedTiles).toBe(ids.length);
    expect(header.clustered).toBe(false); // reusing the shared blob sends offsets backwards
    expect(header.tileType).toBe(TileType.Png);
    expect(await archive.getMetadata()).toEqual({});

    await expectAllReadable(archive, ids);
    expect(await archive.getZxy(9, 400, 200)).toBeUndefined();
  });

  it('spills into leaf directories when the root is capped', async () => {
    const { source, ids } = await buildArchive(EUROPE, 0, 8, { maxRootBytes: 400, leafSize: 200 });
    const archive = new PMTiles(source);
    const header = await archive.getHeader();
    expect(header.leafDirectoryLength).toBeGreaterThan(0);
    expect(header.tileDataOffset).toBe(header.leafDirectoryOffset + header.leafDirectoryLength!);

    await expectAllReadable(archive, ids);
  });

  it('stores identical content once', async () => {
    const one = new TextEncoder().encode('same');
    const deduped = await buildArchive(EUROPE, 0, 6, { body: () => one });
    const unique = await buildArchive(EUROPE, 0, 6, { body: (z, x, y) => new TextEncoder().encode(`tile ${z}/${x}/${y}`) });

    const dedupedHeader = await new PMTiles(deduped.source).getHeader();
    const uniqueHeader = await new PMTiles(unique.source).getHeader();
    expect(uniqueHeader.clustered).toBe(true);
    expect(dedupedHeader.numTileContents).toBe(1);
    expect(dedupedHeader.numTileContents).toBeLessThan(uniqueHeader.numTileContents);
    expect(deduped.builder.dataLength).toBe(4);
    expect(deduped.builder.dataLength).toBeLessThan(unique.builder.dataLength);
    expect(deduped.builder.count).toBe(unique.builder.count);
  });
});

describe('tile ranges', () => {
  it('counts what tileIdsInBounds enumerates', () => {
    expect(tileCountInBounds(EUROPE, 0, 9)).toBe(tileIdsInBounds(EUROPE, 0, 9).length);
  });

  it('matches a hand-computed small case', () => {
    const unit: Bbox = { west: 0, south: 0, east: 1, north: 1 };
    expect(tileRange(unit, 1)).toEqual([{ x0: 1, x1: 1, y0: 0, y1: 1 }]);
    expect(tileCountInBounds(unit, 0, 1)).toBe(3);
    expect(tileIdsInBounds(unit, 0, 1)).toEqual([0, zxyToTileId(1, 1, 0), zxyToTileId(1, 1, 1)].toSorted((a, b) => a - b));
  });

  it('splits an antimeridian box into two x ranges', () => {
    const ranges = tileRange({ west: 170, south: -10, east: -170, north: 10 }, 2);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].x0).toBe(3);
    expect(ranges[0].x1).toBe(3);
    expect(ranges[1].x0).toBe(0);
    expect(ranges[1].x1).toBe(0);
  });
});

describe('coalesceRanges', () => {
  it('merges within the gap and respects the chunk cap', () => {
    const ranges = [
      { offset: 0, length: 10 },
      { offset: 12, length: 5 },
      { offset: 100, length: 5 }
    ];
    expect(coalesceRanges(ranges, 5, 1000)).toEqual([
      { offset: 0, length: 17, ranges: [ranges[0], ranges[1]] },
      { offset: 100, length: 5, ranges: [ranges[2]] }
    ]);
    expect(coalesceRanges(ranges, 5, 12).map((c) => c.length)).toEqual([10, 5, 5]);
    expect(coalesceRanges([{ offset: 0, length: 900 }], 5, 100)).toEqual([{ offset: 0, length: 900, ranges: [{ offset: 0, length: 900 }] }]);
  });
});
