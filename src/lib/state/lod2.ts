import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { suppressRing, type SuppressRing } from '@core/geo/buildingTiles';
import { gpuOnly, isReleased } from '@core/geo/surfaces';
import { LOD2_REGIONS, lod2Credits, type Lod2Region } from '@core/lod2/regions';
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

/** Placed tiles not drawn now, least recently used first; zooming back redraws them without asking the worker again. */
const held = new Map<string, Lod2View>();
let heldTris = 0;
/** Held beyond the drawn tiles; battery over memory, so zooming back and forth never re-places. */
export const LOD2_HELD_TRIS = 8_000_000;

/** Every placed tile the store can draw without the worker, drawn or held. */
export function lod2HeldUrls(): string[] {
  return [...lod2Store.getState().tiles.keys(), ...held.keys()];
}

/** Triangles held off screen, for the debug readout. */
export function lod2HeldStats(): { tiles: number; tris: number } {
  return { tiles: held.size, tris: heldTris };
}

function hold(t: Lod2View): void {
  unhold(t.url);
  held.set(t.url, t);
  heldTris += t.tris;
  for (const [url, o] of held) {
    if (heldTris <= LOD2_HELD_TRIS) break;
    held.delete(url);
    heldTris -= o.tris;
  }
}

function unhold(url: string): Lod2View | undefined {
  const t = held.get(url);
  if (!t) return undefined;
  held.delete(url);
  heldTris -= t.tris;
  return t;
}

/** A new pin, eye or geoid moves every mesh, so nothing placed before can be drawn. */
export function resetLod2(placeKey: string): void {
  held.clear();
  heldTris = 0;
  lod2Store.setState((st) => ({ tiles: new Map(), placeKey, version: st.version + 1, buildMs: 0 }));
}

const view = (tile: Lod2Placed): Lod2View => ({ ...tile, mesh: gpuOnly(tile.mesh), rings: tile.hulls.map(suppressRing) });

/** Forgets every tile whose mesh went to a GL context now gone, so the next request places it again. */
export function dropUploadedLod2(): void {
  for (const [url, t] of held) if (isReleased(t.mesh)) unhold(url);
  const st = lod2Store.getState();
  const tiles = new Map([...st.tiles].filter(([, t]) => !isReleased(t.mesh)));
  if (tiles.size < st.tiles.size) lod2Store.setState({ tiles, version: st.version + 1 });
}

export function addLod2Tile(tile: Lod2Placed): void {
  unhold(tile.url);
  lod2Store.setState((st) => {
    const tiles = new Map(st.tiles);
    tiles.set(tile.url, view(tile));
    return { tiles, version: st.version + 1, buildMs: st.buildMs + tile.ms };
  });
}

/** A tile placed for a superseded request of the same pin and eye; kept for when a later request names it. */
export function holdLod2Tile(tile: Lod2Placed): void {
  if (!lod2Store.getState().tiles.has(tile.url)) hold(view(tile));
}

/** Draws exactly the tiles the finished request kept, holding the rest; false when one it counted on was evicted meanwhile. */
export function finishLod2(urls: readonly string[], tris: number, missing: number, error: string | null): boolean {
  let complete = true;
  lod2Store.setState((st) => {
    const keep = new Set(urls);
    const tiles = new Map<string, Lod2View>();
    for (const u of urls) {
      const t = st.tiles.get(u) ?? unhold(u);
      if (t) tiles.set(u, t);
      else complete = false;
    }
    for (const [u, t] of st.tiles) if (!keep.has(u)) hold(t);
    const buildMs = [...tiles.values()].reduce((a, t) => a + t.ms, 0);
    return { tiles, version: st.version + 1, busy: false, tris, missing, buildMs, error };
  });
  return complete;
}

/** The regions whose tiles are drawn now, for their attribution. */
export function lod2Drawn(tiles: ReadonlyMap<string, Lod2View>): Lod2Region[] {
  const ids = new Set([...tiles.values()].map((t) => t.region));
  return lod2Credits(ids);
}

/** Whether drawn tiles used the imported GSI geoid, and whether any that could have fell back to the constant. */
export function lod2GeoidUse(tiles: ReadonlyMap<string, Lod2View>): { gsi: boolean; approx: boolean } {
  const gsiRegions = new Set(LOD2_REGIONS.filter((r) => r.gsiGeoid).map((r) => r.id));
  let gsi = false;
  let approx = false;
  for (const t of tiles.values()) {
    if (t.geoid) gsi = true;
    else if (gsiRegions.has(t.region)) approx = true;
  }
  return { gsi, approx };
}
