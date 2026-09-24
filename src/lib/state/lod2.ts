import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { suppressRing, type SuppressRing } from '@core/geo/buildingTiles';
import { lod2Credits, type Lod2Region } from '@core/lod2/regions';
import type { Lod2Placed } from '@workers/buildings.protocol';

/** A placed LoD2 tile and the rings its buildings hide Overture rows with. */
export interface Lod2View extends Lod2Placed {
  rings: SuppressRing[];
}

export interface Lod2State {
  /** Placed tiles by url, all for `placeKey`. */
  tiles: ReadonlyMap<string, Lod2View>;
  /** Pin and eye height the meshes are placed for. */
  placeKey: string;
  /** Bumped whenever `tiles` changes. */
  version: number;
  busy: boolean;
  /** Triangles kept by the last request. */
  tris: number;
  /** Tiles the last request could not fetch. */
  missing: number;
  /** Summed worker ms to decode and place the tiles now held. */
  buildMs: number;
  error: string | null;
}

export const lod2Store = create<Lod2State>()(
  subscribeWithSelector(
    (): Lod2State => ({
      tiles: new Map(),
      placeKey: '',
      version: 0,
      busy: false,
      tris: 0,
      missing: 0,
      buildMs: 0,
      error: null
    })
  )
);

export const useLod2 = lod2Store;

export function addLod2Tile(tile: Lod2Placed): void {
  lod2Store.setState((st) => {
    const tiles = new Map(st.tiles);
    tiles.set(tile.url, { ...tile, rings: tile.hulls.map(suppressRing) });
    return { tiles, version: st.version + 1, buildMs: st.buildMs + tile.ms };
  });
}

/** Drops every tile the finished request did not keep. */
export function finishLod2(urls: readonly string[], tris: number, missing: number, error: string | null): void {
  lod2Store.setState((st) => {
    const keep = new Set(urls);
    const tiles = new Map([...st.tiles].filter(([u]) => keep.has(u)));
    const buildMs = [...tiles.values()].reduce((a, t) => a + t.ms, 0);
    return { tiles, version: st.version + 1, busy: false, tris, missing, buildMs, error };
  });
}

/** The regions whose tiles are drawn now, for their attribution. */
export function lod2Drawn(tiles: ReadonlyMap<string, Lod2View>): Lod2Region[] {
  const ids = new Set([...tiles.values()].map((t) => t.region));
  return lod2Credits(ids);
}
