import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { LngLat } from '@core/geo/geodesy';
import { SkySourceKind, type SkySource } from '@core/sky/readout';
import { referenceBins, REACH_KM, SKYGLOW_PARAMS, type GlowBins } from '@core/sky/skyglow';
import { tileName, tileOf, tilesForWindow, VIIRS_MARGIN_KM, windowAround, type ViirsWindow } from '@core/sky/viirs';
import { readViirsWindow, type ViirsStore } from '@data/viirs';
import { SkyglowGl } from '@ui/sky/skyglowGl';
import { clearGibs as clearGibsStore } from '@data/gibs';
import { GibsOutcome, type GibsClearRequest, type GibsRequest, type GibsResponse } from '../workers/gibs.protocol';
import { offlineStore } from './offline';
import { worldStore } from './world';

/** Idle: no imported year here and nothing asks for a GIBS reading. */
export const GlowStatus = { NoPoint: 'NoPoint', Idle: 'Idle', Loading: 'Loading', NoData: 'NoData', Ready: 'Ready', Error: 'Error' } as const;
export type GlowStatus = (typeof GlowStatus)[keyof typeof GlowStatus];

export interface GlowPoint {
  status: GlowStatus;
  /** Sector × ring sums; heights and the calibration constant apply at read time. */
  bins: GlowBins | null;
  source: SkySource | null;
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
  /** Panels showing a sky reading; GIBS is only fetched while above zero. */
  wanted: number;
  /** Holds a GIBS demand until the returned release runs. */
  want(): () => void;
  /** Each point's last GIBS reading: tile count and what it downloaded. */
  gibsLast: Partial<Record<'camera' | 'target', { tiles: number; fetchedTiles: number; fetchedBytes: number; nights: string[] }>>;
  /** Test aid: relative difference of the camera's GPU total from the exact CPU sum. */
  compareReference(): Promise<{ gpu: number; ref: number; rel: number } | null>;
}

const sum = (b: GlowBins) => b.w.reduce((s, v) => s + v, 0);

const empty = (status: GlowStatus): GlowPoint => ({ status, bins: null, source: null, missing: [], error: null });

export const skyglowStore = create<SkyglowState>()(
  subscribeWithSelector(
    (): SkyglowState => ({
      camera: empty(GlowStatus.NoPoint),
      target: empty(GlowStatus.NoPoint),
      runs: 0,
      lastMs: 0,
      wanted: 0,
      want: () => {
        skyglowStore.setState((s) => ({ wanted: s.wanted + 1 }));
        let held = true;
        return () => {
          if (held) skyglowStore.setState((s) => ({ wanted: s.wanted - 1 }));
          held = false;
        };
      },
      gibsLast: {},
      compareReference: async () => {
        const pin = worldStore.getState().pin;
        const cam = skyglowStore.getState().camera;
        if (!cam.bins || !cam.source) return null;
        const win = cam.source.kind === SkySourceKind.Yearly ? (await readViirsWindow(cam.source.year, windowAround(pin, REACH_KM))).win : camGibs?.key === gibsKey(pin) ? camGibs.win : null;
        if (!win) return null;
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
const cache = new Map<string, { bins: GlowBins; source: SkySource }>();
// ~100 m cells: finer moves cannot change a 15″ (~460 m) raster's answer by much.
const cell = (p: LngLat) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}|${SKYGLOW_PARAMS.lambdaKm}`;
const cacheKey = (year: number, p: LngLat) => `${year}|${cell(p)}`;
const gibsKey = (p: LngLat) => `gibs|${cell(p)}`;

const remember = (key: string, v: { bins: GlowBins; source: SkySource }) => {
  cache.set(key, v);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
};

let gpu: SkyglowGl | null = null;
/** What the GPU holds: a year, or one GIBS point's key. */
let loaded: number | string | null = null;
/** The camera's last GIBS window, for compareReference. */
let camGibs: { key: string; win: ViirsWindow } | null = null;

function ensureGpu(): SkyglowGl {
  if (!gpu || gpu.lost) {
    gpu = new SkyglowGl();
    loaded = null;
  }
  return gpu;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (r: GibsResponse) => void>();

function askGibs(req: Omit<GibsRequest, 'id'> | Omit<GibsClearRequest, 'id'>): Promise<GibsResponse> {
  if (!worker) {
    worker = new Worker(new URL('../workers/gibs.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<GibsResponse>) => {
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    });
  }
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker!.postMessage({ ...req, id } satisfies GibsRequest | GibsClearRequest);
  });
}

const inside = (a: Omit<ViirsWindow, 'data'>, b: Omit<ViirsWindow, 'data'>) => a.row0 >= b.row0 && a.row0 + a.rows <= b.row0 + b.rows && a.col0 >= b.col0 && a.col0 + a.cols <= b.col0 + b.cols;

/** Slack loaded around a point so nearby moves reuse the pyramid. */
const SLACK_KM = 50;

function runAt(g: SkyglowGl, p: LngLat): GlowBins {
  const bins = g.run(p.lat, p.lng, SKYGLOW_PARAMS.lambdaKm);
  skyglowStore.setState((s) => ({ runs: s.runs + 1 }));
  return bins;
}

async function binsAt(p: LngLat, year: number): Promise<GlowBins> {
  const key = cacheKey(year, p);
  const hit = cache.get(key);
  if (hit) return hit.bins;
  const g = ensureGpu();
  const cur = g.current;
  if (loaded !== year || !cur || !inside(windowAround(p, REACH_KM, g.maxTexture), cur)) {
    const { win } = await readViirsWindow(year, windowAround(p, REACH_KM + SLACK_KM, g.maxTexture));
    g.load(win, p.lat);
    loaded = year;
  }
  const bins = runAt(g, p);
  remember(key, { bins, source: { kind: SkySourceKind.Yearly, year } });
  return bins;
}

const Point = { Camera: 'camera', Target: 'target' } as const;
type Point = (typeof Point)[keyof typeof Point];

/** Imported yearly data wins where the point's own tile is imported; GIBS nightly covers the rest. */
async function gibsState(p: LngLat, store: ViirsStore, which: Point): Promise<GlowPoint> {
  const key = gibsKey(p);
  const hit = cache.get(key);
  if (hit) return { ...empty(GlowStatus.Ready), bins: hit.bins, source: hit.source };
  if (skyglowStore.getState().wanted <= 0) return empty(GlowStatus.Idle);
  skyglowStore.setState({ [which]: empty(GlowStatus.Loading) });
  const g = ensureGpu();
  const res = await askGibs({ p, win: windowAround(p, REACH_KM, g.maxTexture), nowMs: Date.now() });
  if (res.outcome === GibsOutcome.Offline) return { ...empty(GlowStatus.NoData), missing: missingTiles(p, offerYear(store), store) };
  if (res.outcome === GibsOutcome.Error) return { ...empty(GlowStatus.Error), error: res.error };
  if (res.outcome !== GibsOutcome.Ready || !res.nights.length) return { ...empty(GlowStatus.NoData), missing: missingTiles(p, offerYear(store), store) };
  if (res.fetchedBytes) void offlineStore.getState().refreshGibs();
  skyglowStore.setState((s) => ({ gibsLast: { ...s.gibsLast, [which]: { tiles: res.tiles, fetchedTiles: res.fetchedTiles, fetchedBytes: res.fetchedBytes, nights: res.nights } } }));
  const glow = ensureGpu();
  glow.load(res.win, p.lat);
  loaded = key;
  if (which === Point.Camera) camGibs = { key, win: res.win };
  const source: SkySource = { kind: SkySourceKind.Nightly, nights: res.nights };
  const bins = runAt(glow, p);
  remember(key, { bins, source });
  return { ...empty(GlowStatus.Ready), bins, source };
}

async function pointState(p: LngLat | null, store: ViirsStore, which: Point): Promise<GlowPoint> {
  if (!p) return empty(GlowStatus.NoPoint);
  const year = yearFor(p, store);
  try {
    if (year === null) return await gibsState(p, store, which);
    return { status: GlowStatus.Ready, bins: await binsAt(p, year), source: { kind: SkySourceKind.Yearly, year }, missing: missingTiles(p, year, store), error: null };
  } catch (e) {
    return { ...empty(GlowStatus.Error), error: e instanceof Error ? e.message : String(e) };
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
  const camera = await pointState(pin, store, Point.Camera);
  const target = await pointState(pin2, store, Point.Target);
  skyglowStore.setState({ camera, target, lastMs: performance.now() - t0 });
}

/** Empties the GIBS cache; the next reading refetches, and only once a panel wants one. */
export async function clearGibs(): Promise<void> {
  // Without a worker nothing is in flight or decoded.
  if (worker) {
    const res = await askGibs({ clear: true });
    if (res.outcome === GibsOutcome.Error) throw new Error(res.error);
  } else await clearGibsStore();
  for (const k of cache.keys()) if (k.startsWith('gibs|')) cache.delete(k);
  if (typeof loaded === 'string') loaded = null;
  camGibs = null;
  skyglowStore.setState({ gibsLast: {} });
  await offlineStore.getState().refreshGibs();
  void refresh();
}

const DEBOUNCE_MS = 250;

/** Recomputes on camera, target, VIIRS, demand or connectivity changes, debounced; nothing runs while they stand still. */
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
      loaded = null;
      schedule();
    }),
    skyglowStore.subscribe((s) => s.wanted > 0, (on) => on && schedule())
  ];
  window.addEventListener('online', schedule);
  return () => {
    if (timer) clearTimeout(timer);
    window.removeEventListener('online', schedule);
    for (const off of offs) off();
  };
}
