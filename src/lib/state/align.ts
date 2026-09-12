import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { SkyBody } from '@core/astro/bodies';
import type { LngLat } from '@core/geo/geodesy';
import { AlignRequestKind, AlignResponseKind, HeatMode, type AlignCandidate, type AlignRequest, type AlignResponse, type HeatParams, type HeatResult } from '@workers/align.protocol';
import { settingsStore } from './settings';
import { EYE_HEIGHT_M } from './terrain';
import { worldStore } from './world';

export interface AlignSettings {
  mode: HeatMode;
  body: SkyBody;
  /** Separation still counted as a hit, degrees; also sets the colour scale. */
  toleranceDeg: number;
  windowMin: number;
  rangeKm: number;
  cells: number;
  opacity: number;
  offsetAzDeg: number;
  offsetAltDeg: number;
  minAltAboveTerrainDeg: number;
}

export interface AlignState extends AlignSettings {
  result: HeatResult | null;
  computing: boolean;
  error: string | null;
  /** Camera position the user picked out of the heat layer. */
  candidate: AlignCandidate | null;
  update(patch: Partial<AlignSettings>): void;
  pick(p: LngLat): void;
  clearCandidate(): void;
  applyCandidate(): void;
}

export const DEFAULT_ALIGN_SETTINGS: AlignSettings = {
  mode: HeatMode.Off,
  body: SkyBody.Sun,
  toleranceDeg: 1,
  windowMin: 20,
  rangeKm: 20,
  cells: 64,
  opacity: 0.8,
  offsetAzDeg: 0,
  offsetAltDeg: 0,
  minAltAboveTerrainDeg: 0
};

const needsTarget = (mode: HeatMode) => mode === HeatMode.Align || mode === HeatMode.Time;

/** Params shared by the heat grid and a point pick; `centre` is what the mode centres on. */
function paramsFor(a: AlignSettings, centre: LngLat): HeatParams {
  const w = worldStore.getState();
  return {
    body: a.body,
    centre,
    landmark: w.pin2 ? { ...w.pin2, heightM: w.pin2HeightM } : null,
    eyeAboveGroundM: EYE_HEIGHT_M,
    timeMs: Math.round(w.time / 60_000) * 60_000,
    windowMin: a.windowMin,
    toleranceDeg: a.toleranceDeg,
    offsetAzDeg: a.offsetAzDeg,
    offsetAltDeg: a.offsetAltDeg,
    rangeM: a.rangeKm * 1000,
    cells: a.cells,
    minAltAboveTerrainDeg: a.minAltAboveTerrainDeg
  };
}

let worker: Worker | null = null;
let heatSeq = 0;
let pickSeq = 0;

function alignWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/align.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<AlignResponse>) => {
      const res = e.data;
      if (res.kind === AlignResponseKind.Heat) {
        if (res.id !== heatSeq) return;
        alignStore.setState({ result: res, computing: false, error: null });
      } else if (res.kind === AlignResponseKind.Pick) {
        if (res.id !== pickSeq) return;
        alignStore.setState({ candidate: res.point });
      } else {
        alignStore.setState({ computing: false, error: res.message });
      }
    });
  }
  return worker;
}

const post = (req: AlignRequest) => alignWorker().postMessage(req);

export const alignStore = create<AlignState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        ...DEFAULT_ALIGN_SETTINGS,
        result: null,
        computing: false,
        error: null,
        candidate: null,
        update: (patch) => set(patch),
        pick: (p) => {
          const a = get();
          const w = worldStore.getState();
          if (!w.pin2) {
            set({ error: 'Place a target location' });
            return;
          }
          pickSeq++;
          post({ kind: AlignRequestKind.Pick, id: pickSeq, point: p, ...paramsFor(a, w.pin2) });
        },
        clearCandidate: () => set({ candidate: null }),
        applyCandidate: () => {
          const c = get().candidate;
          if (!c) return;
          const w = worldStore.getState();
          w.setPin({ lng: c.lng, lat: c.lat });
          w.setTime(c.bestMs);
        }
      }),
      {
        name: 'scape.align',
        partialize: (s): AlignSettings => ({
          mode: s.mode,
          body: s.body,
          toleranceDeg: s.toleranceDeg,
          windowMin: s.windowMin,
          rangeKm: s.rangeKm,
          cells: s.cells,
          opacity: s.opacity,
          offsetAzDeg: s.offsetAzDeg,
          offsetAltDeg: s.offsetAltDeg,
          minAltAboveTerrainDeg: s.minAltAboveTerrainDeg
        })
      }
    )
  )
);

export const useAlign = alignStore;

const DEBOUNCE_MS = 200;

/** Recomputes the heat grid whenever the mode, the pins, the moment or the settings change. */
export function startAlignSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastKey = '';

  const compute = () => {
    const a = alignStore.getState();
    const w = worldStore.getState();
    const s = settingsStore.getState();
    if (a.mode === HeatMode.Off || !s.terrain || (needsTarget(a.mode) && !w.pin2)) {
      lastKey = '';
      heatSeq++;
      if (a.result || a.computing) alignStore.setState({ result: null, computing: false, error: null });
      return;
    }
    const params = paramsFor(a, needsTarget(a.mode) ? w.pin2! : w.pin);
    const key = JSON.stringify([a.mode, params]);
    if (key === lastKey) return;
    lastKey = key;
    heatSeq++;
    alignStore.setState({ computing: true, error: null });
    post({ kind: AlignRequestKind.Heat, id: heatSeq, mode: a.mode, ...params });
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(compute, DEBOUNCE_MS);
  };

  compute();
  const unsubs = [
    worldStore.subscribe((s) => [s.pin, s.pin2, s.pin2HeightM, Math.round(s.time / 60_000)], schedule, { equalityFn: (a, b) => a.every((v, i) => v === b[i]) }),
    alignStore.subscribe(schedule),
    settingsStore.subscribe((s) => s.terrain, schedule)
  ];
  return () => {
    for (const u of unsubs) u();
    clearTimeout(timer);
    worker?.terminate();
    worker = null;
  };
}
