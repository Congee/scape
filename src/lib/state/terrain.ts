import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { siteHeightM } from '@core/astro/bodies';
import { distanceM, type LngLat } from '@core/geo/geodesy';
import { endpointAngleDeg, endpointHeightM } from '@core/terrain/los';
import { TerrainKind, type HorizonResult, type MeshResult, type ProfileResult, type TerrainRequest, type TerrainResponse, type ViewResult } from '@workers/terrain.protocol';
import { markersStore } from './markers';
import { settingsStore, type Settings } from './settings';
import { viewfinderStore, type MeshWindow, type ViewWindow } from './viewfinder';
import { useWorld, worldStore, type WorldState } from './world';

/** Eye height above the camera location's ground, added to the observer height setting. */
export const EYE_HEIGHT_M = 1.6;
export const HORIZON_AZ_STEP_DEG = 0.5;
const PROFILE_SAMPLES = 400;

export interface TerrainState {
  /** Ground at the camera and target, metres (the sea surface at sea); null until known. */
  pinGroundM: number | null;
  pin2GroundM: number | null;
  elevationKey: string;
  profile: ProfileResult | null;
  profileKey: string;
  horizon: HorizonResult | null;
  horizonKey: string;
  view: ViewResult | null;
  viewKey: string;
  /** Terrain quadtree levels for the GPU, finest first; grows as the worker streams them in. */
  mesh: MeshResult[];
  meshKey: string;
  /** Ground under viewfinder markers by marker id. */
  markerGroundM: Record<string, number>;
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
    view: null,
    viewKey: '',
    mesh: [],
    meshKey: '',
    markerGroundM: {},
    busy: { Elevation: false, Profile: false, Horizon: false, View: false, Points: false, Mesh: false },
    error: null
    })
  )
);

export const useTerrain = terrainStore;

/** Camera eye above sea level, which sets the air the sky is refracted through; sea level while the ground is unknown. */
export const pinSiteHeightM = (w: Pick<WorldState, 'pinHeightM'>, t: Pick<TerrainState, 'pinGroundM'>) => siteHeightM(t.pinGroundM, w.pinHeightM + EYE_HEIGHT_M);

export function usePinSiteHeightM(): number {
  const pinHeightM = useWorld((s) => s.pinHeightM);
  const pinGroundM = useTerrain((t) => t.pinGroundM);
  return pinSiteHeightM({ pinHeightM }, { pinGroundM });
}

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

/**
 * Elevation angle from the eye to the target: the profile's when it is current, otherwise the very
 * same geometry over the two endpoint elevations, which land far sooner. Null while either endpoint
 * is still unknown, unless `assumeGroundM` stands in for it — a fabricated aim would cut the terrain
 * mesh for the wrong band, but a caller that only needs a number may ask for sea level instead.
 */
export function targetAngleFor(w: W, s: S, t: Pick<TerrainState, 'profile' | 'profileKey' | 'pinGroundM' | 'pin2GroundM'>, assumeGroundM: number | null = null): number | null {
  if (!w.pin2) return null;
  if (t.profile && t.profileKey === profileKeyFor(w, s)) return t.profile.los.targetAngleDeg;
  // With terrain off there is no DEM to wait for; a NaN ground is a gap the endpoints read as sea level.
  const ground = (m: number | null) => (!s.terrain ? 0 : m == null ? assumeGroundM : Number.isNaN(m) ? 0 : m);
  const groundA = ground(t.pinGroundM);
  const groundB = ground(t.pin2GroundM);
  if (groundA == null || groundB == null) return null;
  return endpointAngleDeg(distanceM(w.pin, w.pin2), endpointHeightM(groundA, w.pinHeightM + EYE_HEIGHT_M), endpointHeightM(groundB, w.pin2HeightM));
}

export function viewKeyFor(w: W, s: S, win: ViewWindow | null): string {
  if (!s.terrain || !win) return '';
  return `${k4(w.pin)}|${w.pinHeightM + EYE_HEIGHT_M}|${win.azFromDeg.toFixed(2)}|${win.azSpanDeg.toFixed(2)}|${win.azStepDeg.toFixed(4)}|${win.rangeM}|${win.minStepDeg}`;
}

/** Where the eye is: a mesh built for a different one is geometry for somewhere else. */
const meshAnchorFor = (w: W) => `${k5(w.pin)}|${w.pinHeightM + EYE_HEIGHT_M}`;

/**
 * The mesh depends on the eye, on how far it must reach, and — since the cells inside the frame are
 * cut to a pixel size — on where the frame points and how long the lens is. `MeshWindow` arrives
 * already quantised, so a pan or a zoom that stays inside the last wedge leaves this key alone.
 */
export function meshKeyFor(w: W, s: S, win: MeshWindow | null): string {
  if (!s.terrain || !win) return '';
  return `${meshAnchorFor(w)}|${win.rangeM}|${win.azimuthDeg}|${win.hfovDeg}|${win.vfovDeg}|${win.pitchDeg}|${win.elHalfDeg}|${win.targetRad}`;
}

/** The eye part of every mesh key for this world; any set whose key starts with it sits at the right height. */
export function meshEyeKeyFor(w: W, s: S, win: MeshWindow | null): string {
  return s.terrain && win ? `${meshAnchorFor(w)}|` : '';
}

/** Adds one streamed level to a set, replacing any older build of the same level. */
export const mergeLevel = (set: readonly MeshResult[], r: MeshResult): MeshResult[] => [...set.filter((m) => m.mesh.level !== r.mesh.level), r].toSorted((a, b) => a.mesh.level - b.mesh.level);

export const isComplete = (set: readonly MeshResult[]) => set.length > 0 && set.length === set[0].levels;

const setBusy = (kind: TerrainKind, on: boolean) => terrainStore.setState((st) => ({ busy: { ...st.busy, [kind]: on } }));

/** Keeps pin elevations, the sightline profile and the horizon sweep in step with the world. */
export function startTerrainSync(): () => void {
  const worker = new Worker(new URL('../workers/terrain.worker.ts', import.meta.url), { type: 'module' });
  const seq: Record<TerrainKind, number> = { Elevation: 0, Profile: 0, Horizon: 0, View: 0, Points: 0, Mesh: 0 };
  const pending: Record<TerrainKind, string> = { Elevation: '', Profile: '', Horizon: '', View: '', Points: '', Mesh: '' };
  let pendingPointIds: string[] = [];
  let staged: MeshResult[] | null = null;
  const timers: Partial<Record<TerrainKind, ReturnType<typeof setTimeout>>> = {};

  const post = (req: TerrainRequest) => worker.postMessage(req);

  worker.addEventListener('message', (e: MessageEvent<TerrainResponse>) => {
    const res = e.data;
    if (res.kind === 'Error') {
      if (res.id !== seq[res.of]) return;
      setBusy(res.of, false);
      terrainStore.setState({ error: res.error });
      return;
    }
    if (res.id !== seq[res.kind]) return;
    if (res.kind === TerrainKind.Mesh) {
      if (staged) {
        // A complete set for this eye stays up until the re-cut is complete too, so a pan never blanks it.
        staged = mergeLevel(staged, res.result);
        if (staged.length < res.result.levels) return;
        terrainStore.setState({ mesh: staged, meshKey: pending.Mesh, error: null, busy: { ...terrainStore.getState().busy, Mesh: false } });
        staged = null;
        return;
      }
      // The first level of a new build replaces whatever the last one left; levels after it join in.
      const kept = terrainStore.getState().meshKey === pending.Mesh ? terrainStore.getState().mesh : [];
      const mesh = mergeLevel(kept, res.result);
      terrainStore.setState({ mesh, meshKey: pending.Mesh, error: null, busy: { ...terrainStore.getState().busy, Mesh: mesh.length < res.result.levels } });
      return;
    }
    setBusy(res.kind, false);
    if (res.kind === TerrainKind.Elevation) {
      terrainStore.setState({ pinGroundM: res.elevations[0] ?? null, pin2GroundM: res.elevations[1] ?? null, elevationKey: pending.Elevation, error: null });
    } else if (res.kind === TerrainKind.Points) {
      const markerGroundM: Record<string, number> = {};
      pendingPointIds.forEach((id, i) => (markerGroundM[id] = res.elevations[i]));
      terrainStore.setState({ markerGroundM, error: null });
    } else if (res.kind === TerrainKind.Profile) {
      terrainStore.setState({ profile: res.result, profileKey: pending.Profile, error: null });
    } else if (res.kind === TerrainKind.Horizon) {
      terrainStore.setState({ horizon: res.result, horizonKey: pending.Horizon, error: null });
    } else {
      terrainStore.setState({ view: res.result, viewKey: pending.View, error: null });
    }
  });

  const syncElevation = () => {
    const w = worldStore.getState();
    const s = settingsStore.getState();
    const key = elevationKeyFor(w, s);
    if (key === pending.Elevation) return;
    pending.Elevation = key;
    if (!key) {
      terrainStore.setState({ pinGroundM: null, pin2GroundM: null, elevationKey: '' });
      return;
    }
    setBusy(TerrainKind.Elevation, true);
    post({ kind: TerrainKind.Elevation, id: ++seq.Elevation, points: w.pin2 ? [w.pin, w.pin2] : [w.pin] });
  };

  const syncProfile = () => {
    const w = worldStore.getState();
    const s = settingsStore.getState();
    const key = profileKeyFor(w, s);
    if (key === pending.Profile) return;
    pending.Profile = key;
    if (!key || !w.pin2) {
      terrainStore.setState({ profile: null, profileKey: '' });
      setBusy(TerrainKind.Profile, false);
      return;
    }
    setBusy(TerrainKind.Profile, true);
    post({
      kind: TerrainKind.Profile,
      id: ++seq.Profile,
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
    if (key === pending.Horizon) return;
    pending.Horizon = key;
    if (!key) {
      terrainStore.setState({ horizon: null, horizonKey: '' });
      setBusy(TerrainKind.Horizon, false);
      return;
    }
    setBusy(TerrainKind.Horizon, true);
    post({ kind: TerrainKind.Horizon, id: ++seq.Horizon, pin: w.pin, eyeAboveGroundM: w.pinHeightM + EYE_HEIGHT_M, rangeM: s.horizonRangeKm * 1000, azStepDeg: HORIZON_AZ_STEP_DEG });
  };

  const syncView = () => {
    const w = worldStore.getState();
    const s = settingsStore.getState();
    const win = viewfinderStore.getState().window;
    const key = viewKeyFor(w, s, win);
    if (key === pending.View) return;
    pending.View = key;
    if (!key || !win) {
      terrainStore.setState({ view: null, viewKey: '' });
      setBusy(TerrainKind.View, false);
      return;
    }
    setBusy(TerrainKind.View, true);
    post({ kind: TerrainKind.View, id: ++seq.View, pin: w.pin, eyeAboveGroundM: w.pinHeightM + EYE_HEIGHT_M, ...win });
  };

  const syncMesh = () => {
    const w = worldStore.getState();
    const s = settingsStore.getState();
    const win = viewfinderStore.getState().meshWindow;
    const key = meshKeyFor(w, s, win);
    if (key === pending.Mesh) return;
    const moved = !key || !pending.Mesh.startsWith(`${meshAnchorFor(w)}|`);
    pending.Mesh = key;
    if (!key || !win) {
      staged = null;
      terrainStore.setState({ mesh: [], meshKey: '' });
      setBusy(TerrainKind.Mesh, false);
      return;
    }
    // Only the eye moving makes the levels on screen wrong; a re-cut for a new aim may stay up meanwhile.
    if (moved) terrainStore.setState({ mesh: [] });
    const shown = terrainStore.getState().mesh;
    staged = !moved && isComplete(shown) ? [] : null;
    setBusy(TerrainKind.Mesh, true);
    post({ kind: TerrainKind.Mesh, id: ++seq.Mesh, pin: w.pin, eyeAboveGroundM: w.pinHeightM + EYE_HEIGHT_M, rangeM: win.rangeM, view: { azimuthDeg: win.azimuthDeg, hfovDeg: win.hfovDeg, vfovDeg: win.vfovDeg, pitchDeg: win.pitchDeg, elHalfDeg: win.elHalfDeg, targetRad: win.targetRad } });
  };

  const syncPoints = () => {
  const s = settingsStore.getState();
  const ms = markersStore.getState().markers.filter((m) => m.showInViewfinder);
  const key = s.terrain && viewfinderStore.getState().window ? ms.map((m) => `${m.id}@${k5(m)}`).join(';') : '';
  if (key === pending.Points) return;
  pending.Points = key;
  if (!key) {
    terrainStore.setState({ markerGroundM: {} });
    setBusy(TerrainKind.Points, false);
    return;
  }
  pendingPointIds = ms.map((m) => m.id);
  setBusy(TerrainKind.Points, true);
  post({ kind: TerrainKind.Points, id: ++seq.Points, points: ms.map((m) => ({ lat: m.lat, lng: m.lng })) });
  };

  // Cheap lookups trail the pin closely; the sweeps wait until the pin settles.
  const schedule = (kind: TerrainKind, fn: () => void, waitMs: number) => {
    clearTimeout(timers[kind]);
    timers[kind] = setTimeout(fn, waitMs);
  };
  const onChange = () => {
    schedule(TerrainKind.Elevation, syncElevation, 150);
    schedule(TerrainKind.Profile, syncProfile, 150);
    schedule(TerrainKind.Horizon, syncHorizon, 400);
    schedule(TerrainKind.View, syncView, 250);
    schedule(TerrainKind.Mesh, syncMesh, 250);
    schedule(TerrainKind.Points, syncPoints, 300);
  };

  syncElevation();
  syncProfile();
  syncHorizon();
  syncView();
  syncMesh();
  syncPoints();
  const unsubs = [worldStore.subscribe(onChange), settingsStore.subscribe(onChange), viewfinderStore.subscribe(onChange), markersStore.subscribe(onChange)];
  return () => {
    for (const u of unsubs) u();
    for (const t of Object.values(timers)) clearTimeout(t);
    worker.terminate();
  };
}
