import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { distanceM, type LngLat } from '@core/geo/geodesy';
import { tilePixelToLngLat } from '@core/terrain/tiles';
import type { MaskRect } from '@core/geo/shadowMask';
import { adoptPrismSlots } from '@core/geo/prismOcclude';
import type { Lod2Source } from '@core/lod2/regions';
import { BuildingsKind, MASK_WORKER_NAME, type BuildingBatch, type BuildingsResponse, type GeoidSync, type GroundAtRequest, type HeightAtRequest, type Lod2Request, type MaskRequest, type ModelsSync, type PrismPlaced, type RowsAtRequest, type SuppressedIdsRequest, type TilesRequest, type WorkerModel } from '@workers/buildings.protocol';
import { addLod2Tile, finishLod2, holdLod2Tile, lod2HeldUrls, lod2Store, resetLod2 } from './lod2';

/** Placed tiles kept in the store; beyond this the farthest from the pin are dropped. */
const MAX_TILES = 96;
/** A height lookup that never comes back resolves null rather than leaving the caller hanging. */
const HEIGHT_TIMEOUT_MS = 15_000;
/** Sun angles are rounded to this before they become a key, so scrubbing the clock rebuilds far less. */
const SUN_QUANTUM_DEG = 0.25;

export interface BuildingsState {
  /** Prisms by "14/x/y", each placed for the frame it names. */
  tiles: ReadonlyMap<string, PrismPlaced>;
  /** Bumped on every batch and on Done, so a renderer can subscribe to one number. */
  version: number;
  busy: boolean;
  /** Tiles the last request could not fetch (offline or 404). */
  missing: number;
  /** Ground-shadow mask for the map, or null while none has been built. */
  shadowMask: ShadowMaskField | null;
  /** Worker time for the last mask, milliseconds. */
  shadowMaskMs: number;
  error: string | null;
}

/** A built ground-shadow mask and the rect it covers; row 0 of `mask` is the southernmost. */
export interface ShadowMaskField extends MaskRect {
  centre: LngLat;
  mask: Uint8Array;
  /** LoD2 sources stamped into the mask, for their attribution. */
  lod2: Lod2Source[];
}

export const buildingsStore = create<BuildingsState>()(
  subscribeWithSelector(
    (): BuildingsState => ({
      tiles: new Map(),
      version: 0,
      busy: false,
      missing: 0,
      shadowMask: null,
      shadowMaskMs: 0,
      error: null
    })
  )
);

export const useBuildings = buildingsStore;

let worker: Worker | null = null;
/** The map's mask has its own worker, so a multi-second map build cannot stall the viewfinder. */
let maskWorker: Worker | null = null;
let seq = 0;
/** Id of the wedge request whose responses the store still wants. */
let tilesId = 0;
let lastKey = '';
let lastPin: LngLat = { lat: 0, lng: 0 };
let lastTiles: Parameters<typeof requestBuildings> | null = null;
/** The map's mask keeps its own id, so a pan never cancels the viewfinder's shadow build. */
let maskId = 0;
let maskKey = '';
let lastMask: Omit<MaskRequest, 'id'> | null = null;
/** Sent to each worker as it starts and again on every change. */
let modelsSync: ModelsSync | null = null;
/** Id of the LoD2 request whose responses the store still wants. */
let lod2Id = 0;
let lod2Key = '';
/** First LoD2 request for the current pin and eye; a superseded one since then placed its tiles for them too. */
let lod2PlaceId = 0;
let lastLod2: Parameters<typeof requestLod2> | null = null;
let geoidSync: GeoidSync | null = null;

/** Centre of a "z/x/y" key, for distance-based eviction. */
function tileCentre(key: string): LngLat {
  const [z, x, y] = key.split('/').map(Number);
  return tilePixelToLngLat(z, x, y, 128, 128);
}

function evict(tiles: Map<string, PrismPlaced>, pin: LngLat): Map<string, PrismPlaced> {
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
    const waiter = waiters.get(res.id);
    if (waiter) {
      waiters.delete(res.id);
      clearTimeout(waiter.timer);
      if (res.kind === BuildingsKind.Error) waiter.reject(new Error(res.error));
      else waiter.resolve(res);
      return;
    }
    if (res.kind === BuildingsKind.Height || res.kind === BuildingsKind.Rows || res.kind === BuildingsKind.Ids || res.kind === BuildingsKind.Ground) return; // its waiter already timed out
    if (res.id === lod2Id) {
      if (res.kind === BuildingsKind.Lod2Tile) addLod2Tile(res.tile);
      else if (res.kind === BuildingsKind.Lod2Done) {
        if (!finishLod2(res.urls, res.tris, res.missing, res.error) && lastLod2) {
          lod2Key = '';
          requestLod2(...lastLod2);
        }
      } else if (res.kind === BuildingsKind.Error) lod2Store.setState((st) => ({ busy: false, version: st.version + 1, error: res.error }));
      return;
    }
    if (res.kind === BuildingsKind.Lod2Tile && res.id >= lod2PlaceId) {
      holdLod2Tile(res.tile);
      return;
    }
    if (res.id !== tilesId) return;
    if (res.kind === BuildingsKind.Tiles) {
      buildingsStore.setState((st) => {
        const tiles = new Map(st.tiles);
        adoptPrismSlots(res.tile.prism, res.tile.slots);
        tiles.set(res.tile.tileKey, res.tile);
        return { tiles: evict(tiles, lastPin), version: st.version + 1 };
      });
    } else if (res.kind === BuildingsKind.Done) {
      buildingsStore.setState((st) => ({ busy: false, missing: res.missing, version: st.version + 1, error: null }));
    } else if (res.kind === BuildingsKind.Error) {
      buildingsStore.setState((st) => ({ busy: false, version: st.version + 1, error: res.error }));
    }
  });
  if (modelsSync) worker.postMessage(modelsSync);
  if (geoidSync) worker.postMessage(geoidSync);
  return worker;
}

function ensureMaskWorker(): Worker {
  if (maskWorker) return maskWorker;
  maskWorker = new Worker(new URL('../workers/buildings.worker.ts', import.meta.url), { type: 'module', name: MASK_WORKER_NAME });
  maskWorker.addEventListener('message', (e: MessageEvent<BuildingsResponse>) => {
    const res = e.data;
    if (res.kind === BuildingsKind.Shade) {
      const { centre, originE, originN, nx, ny, cellM, mask, lod2 } = res;
      if (res.id === maskId) buildingsStore.setState({ shadowMask: { centre, originE, originN, nx, ny, cellM, mask, lod2 }, shadowMaskMs: res.ms });
    } else if (res.kind === BuildingsKind.Error) {
      buildingsStore.setState({ error: res.error });
    }
  });
  if (modelsSync) maskWorker.postMessage(modelsSync);
  if (geoidSync) maskWorker.postMessage(geoidSync);
  return maskWorker;
}

/** Streams the wedge's prisms, placed for `eyeM`, into the store; identical consecutive requests are ignored, a new one supersedes the old. */
export function requestBuildings(pin: LngLat, eyeM: number, azFromDeg: number, azSpanDeg: number, rangeM: number): void {
  lastTiles = [pin, eyeM, azFromDeg, azSpanDeg, rangeM];
  const lod2Urls = [...lod2Store.getState().tiles.keys()];
  const key = `${pin.lat.toFixed(6)},${pin.lng.toFixed(6)}|${eyeM.toFixed(2)}|${azFromDeg}|${azSpanDeg}|${rangeM}|${modelsSync?.rev ?? 0}|${lod2Urls.join(' ')}`;
  if (key === lastKey) return;
  lastKey = key;
  lastPin = pin;
  tilesId = ++seq;
  buildingsStore.setState({ busy: true, error: null });
  const have = [...buildingsStore.getState().tiles.values()].map((t): [string, string] => [t.tileKey, t.sig]);
  const req: TilesRequest = { kind: BuildingsKind.Tiles, id: tilesId, pin, eyeM, azFromDeg, azSpanDeg, rangeM, lod2Urls, have };
  ensureWorker().postMessage(req);
}

/** The held tiles give way to LoD2 and model footprints, so either changing re-asks for the last wedge. */
function refreshBuildings(): void {
  if (lastTiles) requestBuildings(...lastTiles);
}

lod2Store.subscribe((s) => s.tiles, refreshBuildings);

/** Streams the wedge's LoD2 meshes, placed for `eyeM`; a new pin or eye height re-places every tile. */
export function requestLod2(pin: LngLat, eyeM: number, azFromDeg: number, azSpanDeg: number, rangeM: number, pxPerRad: number): void {
  lastLod2 = [pin, eyeM, azFromDeg, azSpanDeg, rangeM, pxPerRad];
  const placeKey = `${pin.lat.toFixed(6)},${pin.lng.toFixed(6)}|${eyeM.toFixed(2)}|${geoidSync?.key ?? ''}`;
  const key = `${placeKey}|${azFromDeg}|${azSpanDeg}|${rangeM}|${pxPerRad}`;
  if (key === lod2Key) return;
  lod2Key = key;
  lod2Id = ++seq;
  const st = lod2Store.getState();
  if (st.placeKey !== placeKey) {
    resetLod2(placeKey);
    lod2PlaceId = lod2Id;
  }
  lod2Store.setState({ busy: true, error: null });
  const req: Lod2Request = { kind: BuildingsKind.Lod2, id: lod2Id, pin, eyeM, azFromDeg, azSpanDeg, rangeM, pxPerRad, have: lod2HeldUrls() };
  ensureWorker().postMessage(req);
}

const quantise = (deg: number) => Math.round(deg / SUN_QUANTUM_DEG) * SUN_QUANTUM_DEG;

/** Builds the map's ground-shadow mask; an identical consecutive request is ignored. */
export function requestShadowMask(centre: LngLat, rect: MaskRect, sunAzDeg: number, sunAltDeg: number, softM: number, buildings: boolean): void {
  const az = quantise(sunAzDeg);
  const alt = quantise(sunAltDeg);
  const key = `${centre.lat.toFixed(6)},${centre.lng.toFixed(6)}|${rect.originE}|${rect.originN}|${rect.nx}|${rect.ny}|${rect.cellM}|${az}|${alt}|${softM}|${buildings}`;
  if (key === maskKey) return;
  maskKey = key;
  maskId = ++seq;
  lastMask = { kind: BuildingsKind.Mask, centre, ...rect, sunAzDeg: az, sunAltDeg: alt, softM, buildings };
  ensureMaskWorker().postMessage({ ...lastMask, id: maskId } satisfies MaskRequest);
}

/** Hands the workers the current models and rebuilds the map's mask around them. */
export function setBuildingModels(rev: number, models: WorkerModel[]): void {
  modelsSync = { kind: BuildingsKind.Models, id: ++seq, rev, models };
  worker?.postMessage(modelsSync);
  maskWorker?.postMessage(modelsSync);
  refreshBuildings();
  if (maskWorker && lastMask?.buildings) {
    maskId = ++seq;
    maskWorker.postMessage({ ...lastMask, id: maskId } satisfies MaskRequest);
  }
}

/** Hands the workers the imported geoid's key and re-places what was built on the old one. */
export function setBuildingGeoid(key: string): void {
  if ((geoidSync?.key ?? '') === key) return;
  geoidSync = { kind: BuildingsKind.Geoid, id: ++seq, key };
  worker?.postMessage(geoidSync);
  maskWorker?.postMessage(geoidSync);
  if (worker && lastLod2) requestLod2(...lastLod2);
  if (maskWorker && lastMask?.buildings) {
    maskId = ++seq;
    maskWorker.postMessage({ ...lastMask, id: maskId } satisfies MaskRequest);
  }
}

interface Waiter {
  resolve: (res: BuildingsResponse) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const waiters = new Map<number, Waiter>();

/** One request, one response; null on a timeout or an unexpected reply. */
function ask<T>(req: HeightAtRequest | RowsAtRequest | SuppressedIdsRequest | GroundAtRequest, read: (res: BuildingsResponse) => T | null): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(req.id);
      resolve(null);
    }, HEIGHT_TIMEOUT_MS);
    waiters.set(req.id, { resolve: (res) => resolve(read(res)), reject, timer });
    ensureWorker().postMessage(req);
  });
}

/** Apex of the building under `p`, metres; null when nothing stands there. */
export function buildingHeightAt(p: LngLat): Promise<number | null> {
  return ask({ kind: BuildingsKind.HeightAt, id: ++seq, point: p }, (res) => (res.kind === BuildingsKind.Height ? res.heightM : null));
}

/** Every Overture row of the building under `p`, with its ground; null when nothing stands there. */
export function buildingRowsAt(p: LngLat): Promise<BuildingBatch | null> {
  return ask({ kind: BuildingsKind.RowsAt, id: ++seq, point: p }, (res) => (res.kind === BuildingsKind.Rows ? res.batch : null));
}

/** Overture feature ids the models hide, after the latest `setBuildingModels`; null on a timeout. */
export function suppressedBuildingIds(): Promise<string[] | null> {
  return ask({ kind: BuildingsKind.SuppressedIds, id: ++seq }, (res) => (res.kind === BuildingsKind.Ids ? res.ids : null));
}

/** The lowest DEM ground under `points`, metres; null on a timeout or no data. */
export function groundUnder(points: LngLat[]): Promise<number | null> {
  return ask({ kind: BuildingsKind.GroundAt, id: ++seq, points }, (res) => (res.kind === BuildingsKind.Ground ? res.groundM : null));
}
