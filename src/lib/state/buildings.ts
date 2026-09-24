import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { distanceM, type LngLat } from '@core/geo/geodesy';
import { tilePixelToLngLat } from '@core/terrain/tiles';
import type { MaskRect } from '@core/geo/shadowMask';
import { BuildingsKind, MASK_WORKER_NAME, type BuildingBatch, type BuildingsResponse, type GroundAtRequest, type HeightAtRequest, type MaskRequest, type ModelsSync, type RowsAtRequest, type SuppressedIdsRequest, type TilesRequest, type WorkerModel } from '@workers/buildings.protocol';

/** Decoded tiles kept in the store; beyond this the farthest from the pin are dropped. */
const MAX_TILES = 96;
/** A height lookup that never comes back resolves null rather than leaving the caller hanging. */
const HEIGHT_TIMEOUT_MS = 15_000;
/** Sun angles are rounded to this before they become a key, so scrubbing the clock rebuilds far less. */
const SUN_QUANTUM_DEG = 0.25;

export interface BuildingsState {
  /** Decoded tiles by "14/x/y". */
  tiles: ReadonlyMap<string, BuildingBatch>;
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
/** The map's mask keeps its own id, so a pan never cancels the viewfinder's shadow build. */
let maskId = 0;
let maskKey = '';
let lastMask: Omit<MaskRequest, 'id'> | null = null;
/** Sent to each worker as it starts and again on every change. */
let modelsSync: ModelsSync | null = null;

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
    const waiter = waiters.get(res.id);
    if (waiter) {
      waiters.delete(res.id);
      clearTimeout(waiter.timer);
      if (res.kind === BuildingsKind.Error) waiter.reject(new Error(res.error));
      else waiter.resolve(res);
      return;
    }
    if (res.kind === BuildingsKind.Height || res.kind === BuildingsKind.Rows || res.kind === BuildingsKind.Ids || res.kind === BuildingsKind.Ground) return; // its waiter already timed out
    if (res.id !== tilesId) return;
    if (res.kind === BuildingsKind.Tiles) {
      buildingsStore.setState((st) => {
        const tiles = new Map(st.tiles);
        tiles.set(res.batch.tileKey, res.batch);
        return { tiles: evict(tiles, lastPin), version: st.version + 1 };
      });
    } else if (res.kind === BuildingsKind.Done) {
      buildingsStore.setState((st) => ({ busy: false, missing: res.missing, version: st.version + 1, error: null }));
    } else if (res.kind === BuildingsKind.Error) {
      buildingsStore.setState((st) => ({ busy: false, version: st.version + 1, error: res.error }));
    }
  });
  if (modelsSync) worker.postMessage(modelsSync);
  return worker;
}

function ensureMaskWorker(): Worker {
  if (maskWorker) return maskWorker;
  maskWorker = new Worker(new URL('../workers/buildings.worker.ts', import.meta.url), { type: 'module', name: MASK_WORKER_NAME });
  maskWorker.addEventListener('message', (e: MessageEvent<BuildingsResponse>) => {
    const res = e.data;
    if (res.kind === BuildingsKind.Shade) {
      const { centre, originE, originN, nx, ny, cellM, mask } = res;
      if (res.id === maskId) buildingsStore.setState({ shadowMask: { centre, originE, originN, nx, ny, cellM, mask }, shadowMaskMs: res.ms });
    } else if (res.kind === BuildingsKind.Error) {
      buildingsStore.setState({ error: res.error });
    }
  });
  if (modelsSync) maskWorker.postMessage(modelsSync);
  return maskWorker;
}

/** Streams the wedge's tiles into the store; identical consecutive requests are ignored, a new wedge supersedes the old one. */
export function requestBuildings(pin: LngLat, azFromDeg: number, azSpanDeg: number, rangeM: number): void {
  const key = `${pin.lat.toFixed(6)},${pin.lng.toFixed(6)}|${azFromDeg}|${azSpanDeg}|${rangeM}`;
  if (key === lastKey) return;
  lastKey = key;
  lastPin = pin;
  tilesId = ++seq;
  buildingsStore.setState({ busy: true, error: null });
  const req: TilesRequest = { kind: BuildingsKind.Tiles, id: tilesId, pin, azFromDeg, azSpanDeg, rangeM };
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
