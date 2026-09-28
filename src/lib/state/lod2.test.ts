import { beforeEach, describe, expect, it } from 'vitest';
import type { Lod2Placed } from '@workers/buildings.protocol';
import { releaseUploaded } from '@core/geo/surfaces';
import { addLod2Tile, dropUploadedLod2, finishLod2, holdLod2Tile, LOD2_HELD_TRIS, lod2HeldStats, lod2HeldUrls, lod2Store, resetLod2 } from './lod2';

const tile = (url: string, tris = 10): Lod2Placed => ({ url, region: {} as Lod2Placed['region'], mesh: {} as Lod2Placed['mesh'], hulls: [], bbox: [0, 0, 0, 0], tris, geoid: false, occ: {} as Lod2Placed['occ'], ms: 1 });

describe('lod2 held tiles', () => {
  beforeEach(() => resetLod2('pin'));

  it('holds tiles a finished request drops and redraws the same object later', () => {
    addLod2Tile(tile('a'));
    addLod2Tile(tile('b'));
    const a = lod2Store.getState().tiles.get('a');
    expect(finishLod2(['b'], 10, 0, null)).toBe(true);
    expect([...lod2Store.getState().tiles.keys()]).toEqual(['b']);
    expect(lod2HeldStats()).toEqual({ tiles: 1, tris: 10 });
    expect(lod2HeldUrls().toSorted()).toEqual(['a', 'b']);
    expect(finishLod2(['a', 'b'], 20, 0, null)).toBe(true);
    expect(lod2Store.getState().tiles.get('a')).toBe(a);
    expect(lod2HeldStats()).toEqual({ tiles: 0, tris: 0 });
  });

  it('holds tiles placed by a superseded request', () => {
    holdLod2Tile(tile('c'));
    expect(lod2Store.getState().tiles.size).toBe(0);
    expect(finishLod2(['c'], 10, 0, null)).toBe(true);
    expect(lod2Store.getState().tiles.has('c')).toBe(true);
  });

  it('evicts the least recently held past the cap and reports what it lost', () => {
    holdLod2Tile(tile('old', LOD2_HELD_TRIS));
    holdLod2Tile(tile('new', 1));
    expect(lod2HeldUrls()).toEqual(['new']);
    expect(finishLod2(['old', 'new'], 0, 0, null)).toBe(false);
    expect([...lod2Store.getState().tiles.keys()]).toEqual(['new']);
  });

  it('forgets the tiles a gone GL context held, drawn or held', () => {
    const ts = ['a', 'b', 'c', 'd'].map((u) => tile(u));
    for (const t of ts) addLod2Tile(t);
    finishLod2(['a', 'b'], 20, 0, null);
    for (const t of [ts[0], ts[2]]) releaseUploaded(t.mesh);
    dropUploadedLod2();
    expect([...lod2Store.getState().tiles.keys()]).toEqual(['b']);
    expect(lod2HeldUrls().toSorted()).toEqual(['b', 'd']);
  });

  it('forgets everything on a new pin or eye', () => {
    addLod2Tile(tile('a'));
    finishLod2([], 0, 0, null);
    resetLod2('pin2');
    expect(lod2HeldUrls()).toEqual([]);
    expect(lod2Store.getState().placeKey).toBe('pin2');
  });
});
