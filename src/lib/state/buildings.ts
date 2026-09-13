import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { distanceM, type LngLat } from '@core/geo/geodesy';
import { tilePixelToLngLat } from '@core/terrain/tiles';
import { BuildingsKind, type BuildingBatch, type BuildingsResponse, type TilesRequest } from '@workers/buildings.protocol';

/** Decoded tiles kept in the store; beyond this the farthest from the pin are dropped. */
const MAX_TILES = 96;

export interface BuildingsState {
  /** Decoded tiles by "14/x/y". */
  tiles: ReadonlyMap<string, BuildingBatch>;
  /** Bumped on every batch and on Done, so a renderer can subscribe to one number. */
  version: number;
  busy: boolean;
  /** Tiles the last request could not fetch (offline or 404). */
  missing: number;
  error: string | null;
}

export const buildingsStore = create<BuildingsState>()(
  subscribeWithSelector(
    (): BuildingsState => ({
      tiles: new Map(),
      version: 0,
      busy: false,
      missing: 0,
      error: null
    })
  )
);

export const useBuildings = buildingsStore;

let worker: Worker | null = null;
let seq = 0;
let lastKey = '';
let lastPin: LngLat = { lat: 0, lng: 0 };

/** Centre of a "z/x/y" key, for distance-based eviction. */
function tileCentre(key: string): LngLat {
  const [z, x, y] = key.split('/').map(Number);
  return tilePixelToLngLat(z, x, y, 128, 128);
}

function evict(tiles: Map<string, BuildingBatch>, pin: LngLat): Map<string, BuildingBatch> {
  if (tiles.size <= MAX_TILES) return tiles;
  const byDist = [...tiles.keys()].map((k) => ({ k, d: distanceM(pin, tileCentre(k)) })).toSorted((a, b) => a.d - b.d);
  for (const { k } of byDist.slice(MAX_TILES)) tiles.delete(k);
  return tiles;
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/buildings.worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (e: MessageEvent<BuildingsResponse>) => {
    const res = e.data;
    if (res.id !== seq) return;
    if (res.kind === BuildingsKind.Tiles) {
      buildingsStore.setState((st) => {
        const tiles = new Map(st.tiles);
        tiles.set(res.batch.tileKey, res.batch);
        return { tiles: evict(tiles, lastPin), version: st.version + 1 };
      });
    } else if (res.kind === BuildingsKind.Done) {
      buildingsStore.setState((st) => ({ busy: false, missing: res.missing, version: st.version + 1, error: null }));
    } else {
      buildingsStore.setState((st) => ({ busy: false, version: st.version + 1, error: res.error }));
    }
  });
  return worker;
}

/** Streams the wedge's tiles into the store; identical consecutive requests are ignored, a new wedge supersedes the old one. */
export function requestBuildings(pin: LngLat, azFromDeg: number, azSpanDeg: number, rangeM: number): void {
  const key = `${pin.lat.toFixed(6)},${pin.lng.toFixed(6)}|${azFromDeg}|${azSpanDeg}|${rangeM}`;
  if (key === lastKey) return;
  lastKey = key;
  lastPin = pin;
  buildingsStore.setState({ busy: true, error: null });
  const req: TilesRequest = { kind: BuildingsKind.Tiles, id: ++seq, pin, azFromDeg, azSpanDeg, rangeM };
  ensureWorker().postMessage(req);
}
