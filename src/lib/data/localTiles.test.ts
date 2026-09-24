import { describe, expect, it, vi } from 'vitest';
import type { Bbox } from '@core/geo/bbox';
import { ArchiveKind, type ArchiveMeta } from '@workers/region.protocol';
import { LocalTiles, readThrough, type LocalArchive } from './localTiles';

const bbox: Bbox = { west: -74.035, south: 40.735, east: -73.995, north: 40.76 };
// z14 tile under 30 Hudson Yards, and one far outside the box.
const inside = { z: 14, x: 4824, y: 6157 };
const outside = { z: 14, x: 4900, y: 6100 };

const meta = (id: string, kind: ArchiveKind): ArchiveMeta => ({
  id,
  name: id,
  kind,
  bbox,
  minZoom: 14,
  maxZoom: 14,
  bytes: 0,
  tileCount: 0,
  sourceUrl: '',
  downloadedAt: ''
});

/** An archive holding exactly `tiles`, each answering with its key's bytes. */
function archive(id: string, tiles: string[]): LocalArchive & { getZxy: ReturnType<typeof vi.fn> } {
  const getZxy = vi.fn((z: number, x: number, y: number) => {
    const key = `${z}/${x}/${y}`;
    return Promise.resolve(tiles.includes(key) ? { data: new TextEncoder().encode(`${id}:${key}`).buffer } : undefined);
  });
  return { meta: meta(id, ArchiveKind.Buildings), pm: { getZxy } as unknown as LocalArchive['pm'], getZxy };
}

const text = (b: ArrayBuffer | null) => (b ? new TextDecoder().decode(b) : null);
const key = (t: { z: number; x: number; y: number }) => `${t.z}/${t.x}/${t.y}`;

describe('LocalTiles', () => {
  it('opens only its own kind', async () => {
    const open = vi.fn(() => Promise.resolve([]));
    await new LocalTiles(ArchiveKind.Buildings, open, () => true).tile(inside.z, inside.x, inside.y);
    expect(open).toHaveBeenCalledWith(ArchiveKind.Buildings);
  });

  it('serves the first archive holding the tile', async () => {
    const a = archive('a', []);
    const b = archive('b', [key(inside)]);
    const local = new LocalTiles(ArchiveKind.Buildings, () => Promise.resolve([a, b]), () => true);
    expect(text(await local.tile(inside.z, inside.x, inside.y))).toBe(`b:${key(inside)}`);
  });

  it('skips archives by zoom and footprint without reading them', async () => {
    const a = archive('a', [key(outside), '13/2412/3078']);
    const local = new LocalTiles(ArchiveKind.Buildings, () => Promise.resolve([a]), () => true);
    expect(await local.tile(outside.z, outside.x, outside.y)).toBeNull();
    expect(await local.tile(13, 2412, 3078)).toBeNull();
    expect(a.getZxy).not.toHaveBeenCalled();
  });

  it('treats a failing archive as a miss', async () => {
    const bad: LocalArchive = { meta: meta('bad', ArchiveKind.Buildings), pm: { getZxy: () => Promise.reject(new Error('gone')) } as unknown as LocalArchive['pm'] };
    const local = new LocalTiles(ArchiveKind.Buildings, () => Promise.resolve([bad]), () => true);
    expect(await local.tile(inside.z, inside.x, inside.y)).toBeNull();
  });

  it('re-lists after refresh', async () => {
    const open = vi.fn(() => Promise.resolve([]));
    const local = new LocalTiles(ArchiveKind.Buildings, open, () => true);
    await local.tile(inside.z, inside.x, inside.y);
    await local.tile(inside.z, inside.x, inside.y);
    local.refresh();
    await local.tile(inside.z, inside.x, inside.y);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('reads nothing where OPFS is unsupported', async () => {
    const open = vi.fn(() => Promise.resolve([]));
    expect(await new LocalTiles(ArchiveKind.Buildings, open, () => false).tile(inside.z, inside.x, inside.y)).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});

describe('readThrough', () => {
  it('does not touch the network on a local hit', async () => {
    const remote = vi.fn(() => Promise.resolve('remote'));
    expect(await readThrough(() => Promise.resolve('local'), remote)).toBe('local');
    expect(remote).not.toHaveBeenCalled();
  });

  it('falls back to the network on a local miss', async () => {
    expect(await readThrough(() => Promise.resolve(null), () => Promise.resolve('remote'))).toBe('remote');
  });

  it('passes a network failure through', async () => {
    await expect(readThrough(() => Promise.resolve(null), () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
  });
});
