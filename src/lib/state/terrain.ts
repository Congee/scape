import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { LngLat } from '@core/geo/geodesy';
import type { HorizonResult, ProfileResult, TerrainKind, TerrainRequest, TerrainResponse } from '@workers/terrain.protocol';
import { settingsStore, type Settings } from './settings';
import { worldStore, type WorldState } from './world';

/** Camera height above the pin's ground, added to the observer height setting. */
export const EYE_HEIGHT_M = 1.6;
export const HORIZON_AZ_STEP_DEG = 0.5;
const PROFILE_SAMPLES = 400;

export interface TerrainState {
  /** Raw DEM ground at the pins, metres (bathymetry where at sea); null until known. */
  pinGroundM: number | null;
  pin2GroundM: number | null;
  elevationKey: string;
  profile: ProfileResult | null;
  profileKey: string;
  horizon: HorizonResult | null;
  horizonKey: string;
  busy: Record<TerrainKind, boolean>;
  error: string | null;
}

export const terrainStore = create<TerrainState>()(
  subscribeWithSelector(
    (): TerrainState => ({
    pinGroundM: null,
    pin2GroundM: null,
    elevationKey: '',
    profile: null,
    profileKey: '',
    horizon: null,
    horizonKey: '',
    busy: { elevation: false, profile: false, horizon: false },
    error: null
    })
  )
);

export const useTerrain = terrainStore;

type W = Pick<WorldState, 'pin' | 'pinHeightM' | 'pin2' | 'pin2HeightM'>;
type S = Pick<Settings, 'terrain' | 'terrainHorizon' | 'horizonRangeKm'>;

const k5 = (p: LngLat) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
const k4 = (p: LngLat) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;

/** Identity of the horizon the current world needs; empty when no horizon should exist. */
export function horizonKeyFor(w: W, s: S): string {
  if (!s.terrain || !s.terrainHorizon) return '';
  return `${k4(w.pin)}|${w.pinHeightM + EYE_HEIGHT_M}|${s.horizonRangeKm}`;
}

export function profileKeyFor(w: W, s: S): string {
  if (!s.terrain || !w.pin2) return '';
  return `${k5(w.pin)}|${k5(w.pin2)}|${w.pinHeightM + EYE_HEIGHT_M}|${w.pin2HeightM}`;
}

export function elevationKeyFor(w: W, s: S): string {
  if (!s.terrain) return '';
  return `${k5(w.pin)}|${w.pin2 ? k5(w.pin2) : '-'}`;
}

const setBusy = (kind: TerrainKind, on: boolean) => terrainStore.setState((st) => ({ busy: { ...st.busy, [kind]: on } }));

/** Keeps pin elevations, the sightline profile and the horizon sweep in step with the world. */
export function startTerrainSync(): () => void {
  const worker = new Worker(new URL('../workers/terrain.worker.ts', import.meta.url), { type: 'module' });
  const seq: Record<TerrainKind, number> = { elevation: 0, profile: 0, horizon: 0 };
  const pending: Record<TerrainKind, string> = { elevation: '', profile: '', horizon: '' };
  const timers: Partial<Record<TerrainKind, ReturnType<typeof setTimeout>>> = {};

  const post = (req: TerrainRequest) => worker.postMessage(req);

  worker.addEventListener('message', (e: MessageEvent<TerrainResponse>) => {
    const res = e.data;
    if (res.kind === 'error') {
      if (res.id !== seq[res.of]) return;
      setBusy(res.of, false);
      terrainStore.setState({ error: res.error });
      return;
    }
    if (res.id !== seq[res.kind]) return;
    setBusy(res.kind, false);
    if (res.kind === 'elevation') {
      terrainStore.setState({ pinGroundM: res.elevations[0] ?? null, pin2GroundM: res.elevations[1] ?? null, elevationKey: pending.elevation, error: null });
    } else if (res.kind === 'profile') {
      terrainStore.setState({ profile: res.result, profileKey: pending.profile, error: null });
    } else {
      terrainStore.setState({ horizon: res.result, horizonKey: pending.horizon, error: null });
    }
  });

  const syncElevation = () => {
    const w = worldStore.getState();
    const s = settingsStore.getState();
    const key = elevationKeyFor(w, s);
    if (key === pending.elevation) return;
    pending.elevation = key;
    if (!key) {
      terrainStore.setState({ pinGroundM: null, pin2GroundM: null, elevationKey: '' });
      return;
    }
    setBusy('elevation', true);
    post({ kind: 'elevation', id: ++seq.elevation, points: w.pin2 ? [w.pin, w.pin2] : [w.pin] });
  };

  const syncProfile = () => {
    const w = worldStore.getState();
    const s = settingsStore.getState();
    const key = profileKeyFor(w, s);
    if (key === pending.profile) return;
    pending.profile = key;
    if (!key || !w.pin2) {
      terrainStore.setState({ profile: null, profileKey: '' });
      setBusy('profile', false);
      return;
    }
    setBusy('profile', true);
    post({
      kind: 'profile',
      id: ++seq.profile,
      a: w.pin,
      b: w.pin2,
      eyeAboveGroundM: w.pinHeightM + EYE_HEIGHT_M,
      targetAboveGroundM: w.pin2HeightM,
      samples: PROFILE_SAMPLES
    });
  };

  const syncHorizon = () => {
    const w = worldStore.getState();
    const s = settingsStore.getState();
    const key = horizonKeyFor(w, s);
    if (key === pending.horizon) return;
    pending.horizon = key;
    if (!key) {
      terrainStore.setState({ horizon: null, horizonKey: '' });
      setBusy('horizon', false);
      return;
    }
    setBusy('horizon', true);
    post({ kind: 'horizon', id: ++seq.horizon, pin: w.pin, eyeAboveGroundM: w.pinHeightM + EYE_HEIGHT_M, rangeM: s.horizonRangeKm * 1000, azStepDeg: HORIZON_AZ_STEP_DEG });
  };

  // Cheap lookups trail the pin closely; the sweep waits until the pin settles.
  const schedule = (kind: TerrainKind, fn: () => void, waitMs: number) => {
    clearTimeout(timers[kind]);
    timers[kind] = setTimeout(fn, waitMs);
  };
  const onChange = () => {
    schedule('elevation', syncElevation, 150);
    schedule('profile', syncProfile, 150);
    schedule('horizon', syncHorizon, 400);
  };

  syncElevation();
  syncProfile();
  syncHorizon();
  const unsubs = [worldStore.subscribe(onChange), settingsStore.subscribe(onChange)];
  return () => {
    for (const u of unsubs) u();
    for (const t of Object.values(timers)) clearTimeout(t);
    worker.terminate();
  };
}
