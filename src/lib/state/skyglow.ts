import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { LngLat } from '@core/geo/geodesy';
import { referenceBins, REACH_KM, SKYGLOW_PARAMS, type GlowBins } from '@core/sky/skyglow';
import { tileName, tileOf, tilesForWindow, VIIRS_MARGIN_KM, windowAround, type ViirsWindow } from '@core/sky/viirs';
import { readViirsWindow, type ViirsStore } from '@data/viirs';
import { SkyglowGl } from '@ui/sky/skyglowGl';
import { offlineStore } from './offline';
import { worldStore } from './world';

export const GlowStatus = { NoPoint: 'NoPoint', NoData: 'NoData', Ready: 'Ready', Error: 'Error' } as const;
export type GlowStatus = (typeof GlowStatus)[keyof typeof GlowStatus];

export interface GlowPoint {
  status: GlowStatus;
  /** Sector × ring sums; heights and the calibration constant apply at read time. */
  bins: GlowBins | null;
  year: number | null;
  /** Tiles within the model margin that are published but not imported, e.g. "h18v03". */
  missing: string[];
  error: string | null;
}

export interface SkyglowState {
  camera: GlowPoint;
  target: GlowPoint;
  /** GPU integrations run, for the smoke test's one-update-per-move check. */
  runs: number;
  /** Wall time of the last refresh's reads and GPU work, ms. */
  lastMs: number;
  /** Test aid: relative difference of the camera's GPU total from the exact CPU sum. */
  compareReference(): Promise<{ gpu: number; ref: number; rel: number } | null>;
}

const sum = (b: GlowBins) => b.w.reduce((s, v) => s + v, 0);

const empty = (status: GlowStatus): GlowPoint => ({ status, bins: null, year: null, missing: [], error: null });

export const skyglowStore = create<SkyglowState>()(
  subscribeWithSelector(
    (): SkyglowState => ({
      camera: empty(GlowStatus.NoPoint),
      target: empty(GlowStatus.NoPoint),
      runs: 0,
      lastMs: 0,
      compareReference: async () => {
        const pin = worldStore.getState().pin;
        const cam = skyglowStore.getState().camera;
        if (!cam.bins || cam.year === null) return null;
        const { win } = await readViirsWindow(cam.year, windowAround(pin, REACH_KM));
        const ref = sum(referenceBins(win, pin.lat, pin.lng, SKYGLOW_PARAMS.lambdaKm));
        const gpu = sum(cam.bins);
        return { gpu, ref, rel: ref > 0 ? gpu / ref - 1 : 0 };
      }
    })
  )
);

export const useSkyglow = skyglowStore;

/** The newest year holding the point's own tile. */
export function yearFor(p: LngLat, store: ViirsStore): number | null {
  const t = tileName(tileOf(p));
  let best: number | null = null;
  for (const s of store.tiles) if (s.tile === t && (best === null || s.year > best)) best = s.year;
  return best;
}

/** Tiles the model reads around a point that the year's listing has (all, without a listing) but the store lacks. */
export function missingTiles(p: LngLat, year: number, store: ViirsStore): string[] {
  const have = new Set(store.tiles.filter((t) => t.year === year).map((t) => t.tile));
  const listed = store.listings[year];
  const need = [...new Set(tilesForWindow(windowAround(p, VIIRS_MARGIN_KM)).map(tileName))];
  return need.filter((t) => !have.has(t) && (!listed || listed.includes(t)));
}

/** The year to offer for download: the newest fetched listing, else last year's composite. */
export function offerYear(store: ViirsStore, now = new Date()): number {
  const years = Object.keys(store.listings).map(Number);
  return years.length ? Math.max(...years) : now.getUTCFullYear() - 1;
}

const CACHE_MAX = 64;
const cache = new Map<string, GlowBins>();
// ~100 m cells: finer moves cannot change a 15″ (~460 m) raster's answer by much.
const cacheKey = (year: number, p: LngLat) => `${year}|${p.lat.toFixed(3)},${p.lng.toFixed(3)}|${SKYGLOW_PARAMS.lambdaKm}`;

let gpu: SkyglowGl | null = null;
let loadedYear: number | null = null;

const inside = (a: Omit<ViirsWindow, 'data'>, b: Omit<ViirsWindow, 'data'>) => a.row0 >= b.row0 && a.row0 + a.rows <= b.row0 + b.rows && a.col0 >= b.col0 && a.col0 + a.cols <= b.col0 + b.cols;

/** Slack loaded around a point so nearby moves reuse the pyramid. */
const SLACK_KM = 50;

async function binsAt(p: LngLat, year: number): Promise<GlowBins> {
  const key = cacheKey(year, p);
  const hit = cache.get(key);
  if (hit) return hit;
  if (!gpu || gpu.lost) {
    gpu = new SkyglowGl();
    loadedYear = null;
  }
  const cur = gpu.current;
  if (loadedYear !== year || !cur || !inside(windowAround(p, REACH_KM, gpu.maxTexture), cur)) {
    const { win } = await readViirsWindow(year, windowAround(p, REACH_KM + SLACK_KM, gpu.maxTexture));
    gpu.load(win, p.lat);
    loadedYear = year;
  }
  const bins = gpu.run(p.lat, p.lng, SKYGLOW_PARAMS.lambdaKm);
  skyglowStore.setState((s) => ({ runs: s.runs + 1 }));
  cache.set(key, bins);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return bins;
}

async function pointState(p: LngLat | null, store: ViirsStore): Promise<GlowPoint> {
  if (!p) return empty(GlowStatus.NoPoint);
  const year = yearFor(p, store);
  if (year === null) return { ...empty(GlowStatus.NoData), missing: missingTiles(p, offerYear(store), store) };
  try {
    return { status: GlowStatus.Ready, bins: await binsAt(p, year), year, missing: missingTiles(p, year, store), error: null };
  } catch (e) {
    return { ...empty(GlowStatus.Error), year, error: e instanceof Error ? e.message : String(e) };
  }
}

let running: Promise<void> = Promise.resolve();

// Serialised: the GPU holds one window, and a read awaits between checking and loading it.
const refresh = (): Promise<void> => (running = running.then(update, update));

async function update(): Promise<void> {
  const { pin, pin2 } = worldStore.getState();
  const store = offlineStore.getState().viirs;
  const t0 = performance.now();
  // Sequential: both points may share one loaded window.
  const camera = await pointState(pin, store);
  const target = await pointState(pin2, store);
  skyglowStore.setState({ camera, target, lastMs: performance.now() - t0 });
}

const DEBOUNCE_MS = 250;

/** Recomputes on camera, target or VIIRS changes, debounced; nothing runs while they stand still. */
export function startSkyglowSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void refresh();
    }, DEBOUNCE_MS);
  };
  void refresh();
  const offs = [
    worldStore.subscribe((s) => s.pin, schedule),
    worldStore.subscribe((s) => s.pin2, schedule),
    offlineStore.subscribe((s) => s.viirs, () => {
      cache.clear();
      loadedYear = null;
      schedule();
    })
  ];
  return () => {
    if (timer) clearTimeout(timer);
    for (const off of offs) off();
  };
}
