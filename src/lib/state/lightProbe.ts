import type { Observer } from 'astronomy-engine';
import { create } from 'zustand';
import { makeObserver, siteHeightM } from '@core/astro/bodies';
import { dayCurve } from '@core/astro/dayCurve';
import { firstLastLight, sunLitAt, type FirstLastLight } from '@core/astro/lightSource';
import type { LngLat } from '@core/geo/geodesy';
import { TerrainKind, type HorizonResult, type TerrainResponse } from '@workers/terrain.protocol';
import { dayBounds } from '@core/time/localDay';
import { settingsStore } from './settings';
import { EYE_HEIGHT_M, HORIZON_AZ_STEP_DEG } from './terrain';
import { worldStore } from './world';

export interface LightProbeState {
  /** A ground point asked about, apart from the camera; null until one is picked. */
  point: LngLat | null;
  /** The next map click sets the point. */
  picking: boolean;
  horizon: HorizonResult | null;
  /** First and last sun on the current day against the point's skyline. */
  light: FirstLastLight | null;
  busy: boolean;
  error: string | null;
  setPicking: (on: boolean) => void;
  setPoint: (p: LngLat | null) => void;
}

let worker: Worker | null = null;
let seq = 0;
let dayKey = '';

export const lightProbeStore = create<LightProbeState>()((set) => ({
  point: null,
  picking: false,
  horizon: null,
  light: null,
  busy: false,
  error: null,
  setPicking: (picking) => set({ picking }),
  setPoint: (point) => {
    set({ point, picking: false, horizon: null, light: null, error: null, busy: !!point });
    dayKey = '';
    if (point) sweep(point);
  }
}));

export const useLightProbe = lightProbeStore;

/** Eye height over the point's own ground, so first light and alpenglow see the same sky. */
export function lightPointObserver(point: LngLat, horizon: Pick<HorizonResult, 'groundM'>): Observer {
  return makeObserver(point, siteHeightM(horizon.groundM, EYE_HEIGHT_M));
}

function sweep(point: LngLat) {
  if (!worker) {
    worker = new Worker(new URL('../workers/terrain.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<TerrainResponse>) => {
      const res = e.data;
      if (res.id !== seq) return;
      if (res.kind === 'Error') return lightProbeStore.setState({ busy: false, error: res.error });
      if (res.kind !== TerrainKind.Horizon) return;
      lightProbeStore.setState({ busy: false, horizon: res.result });
      relight();
    });
    // The day follows the clock; the sweep does not.
    worldStore.subscribe(relight);
  }
  worker.postMessage({ kind: TerrainKind.Horizon, id: ++seq, pin: point, eyeAboveGroundM: EYE_HEIGHT_M, rangeM: settingsStore.getState().horizonRangeKm * 1000, azStepDeg: HORIZON_AZ_STEP_DEG });
}

function relight() {
  const { point, horizon } = lightProbeStore.getState();
  if (!point || !horizon) return;
  const w = worldStore.getState();
  const b = dayBounds(new Date(w.time), w.tz);
  const obs = lightPointObserver(point, horizon);
  const key = `${b.isoDate}|${w.tz}`;
  const prev = lightProbeStore.getState().light;
  if (key === dayKey && prev) {
    const now = sunLitAt(obs, horizon.profile, w.time);
    if (now !== prev.litNow) lightProbeStore.setState({ light: { ...prev, litNow: now } });
    return;
  }
  dayKey = key;
  const startMs = b.start.getTime();
  const endMs = b.end.getTime();
  lightProbeStore.setState({ light: firstLastLight(obs, dayCurve(obs, startMs, endMs), horizon.profile, endMs, w.time) });
}
