import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SkyBody } from '@core/astro/bodies';
import { SkyFilter, type FinderHit, type FinderQuery, type FinderSettings } from '@core/astro/finder';
import { height, Units } from '@core/format';
import { bearingDeg, distanceM, elevationAngleDeg, normalizeBearing, type LngLat } from '@core/geo/geodesy';
import { effectiveOptics, frameFov } from '@core/optics/fov';
import { formatDate, formatTime } from '@core/time/format';
import { addLocalDays, dayBounds, localMidnight } from '@core/time/localDay';
import { FinderResponseKind, type FinderRequest, type FinderResponse } from '@workers/finder.protocol';
import { aimFor, compositionStore } from './composition';
import { gearStore, sensorById } from './gear';
import { settingsStore } from './settings';
import { EYE_HEIGHT_M, horizonKeyFor, profileKeyFor, terrainStore } from './terrain';
import { worldStore } from './world';

export interface FinderState {
  settings: FinderSettings;
  running: boolean;
  /** Share of the date range scanned, 0..1. */
  progress: number;
  hits: FinderHit[];
  /** Passes found before the filters. */
  total: number;
  elapsedMs: number;
  error: string | null;
  /** Camera position the current results were computed for. */
  pin: LngLat | null;
  update(patch: Partial<FinderSettings>): void;
  run(): void;
  cancel(): void;
  /** Window around the direction to the target location. */
  fromTarget(): void;
  /** Window matching the current frame's angle of view. */
  fromFrame(): void;
  toCsv(units: Units): string;
}

export const DEFAULT_FINDER_SETTINGS: FinderSettings = {
  body: SkyBody.Sun,
  azFromDeg: 240,
  azToDeg: 300,
  altMinDeg: 0,
  altMaxDeg: 10,
  startIso: '',
  days: 90,
  sky: SkyFilter.Any,
  moonIllumMin: 0,
  moonIllumMax: 1,
  moonDown: false,
  weekdays: null,
  aboveTerrain: true,
  toleranceDeg: 2
};

const todayIso = () => dayBounds(new Date(), worldStore.getState().tz).isoDate;

/** Sightline elevation angle to the target, from the terrain profile when it is current. */
function targetAngleDeg(): number {
  const w = worldStore.getState();
  if (!w.pin2) return 0;
  const t = terrainStore.getState();
  const s = settingsStore.getState();
  if (t.profile && t.profileKey === profileKeyFor(w, s)) return t.profile.los.targetAngleDeg;
  const eyeM = Math.max(t.pinGroundM ?? 0, 0) + w.pinHeightM + EYE_HEIGHT_M;
  const topM = Math.max(t.pin2GroundM ?? 0, 0) + w.pin2HeightM;
  return elevationAngleDeg(distanceM(w.pin, w.pin2), topM - eyeM);
}

/** The settings resolved against the world's time zone. */
export function finderQuery(f: FinderSettings, tz: string): FinderQuery {
  const [y, m, d] = (f.startIso || todayIso()).split('-').map(Number);
  const start = localMidnight(y, m, d, tz);
  return {
    body: f.body,
    azFromDeg: f.azFromDeg,
    azToDeg: f.azToDeg,
    altMinDeg: f.altMinDeg,
    altMaxDeg: f.altMaxDeg,
    startMs: start.getTime(),
    endMs: addLocalDays(start, f.days, tz).getTime(),
    tz,
    sky: f.sky,
    moonIllumMin: f.moonIllumMin,
    moonIllumMax: f.moonIllumMax,
    moonDown: f.moonDown,
    weekdays: f.weekdays
  };
}

let worker: Worker | null = null;
let seq = 0;

function finderWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/finder.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<FinderResponse>) => {
      const res = e.data;
      if (res.id !== seq) return;
      if (res.kind === FinderResponseKind.Progress) finderStore.setState({ progress: res.fraction, hits: res.hits, total: res.total });
      else if (res.kind === FinderResponseKind.Done) finderStore.setState({ running: false, progress: 1, hits: res.hits, total: res.total, elapsedMs: res.elapsedMs });
      else finderStore.setState({ running: false, error: res.message });
    });
  }
  return worker;
}

export const finderStore = create<FinderState>()(
  persist(
    (set, get) => ({
      settings: { ...DEFAULT_FINDER_SETTINGS, startIso: todayIso() },
      running: false,
      progress: 0,
      hits: [],
      total: 0,
      elapsedMs: 0,
      error: null,
      pin: null,
      update: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      run: () => {
        const f = get().settings;
        const w = worldStore.getState();
        const s = settingsStore.getState();
        const t = terrainStore.getState();
        const hk = horizonKeyFor(w, s);
        const horizon = f.aboveTerrain && hk && t.horizon && t.horizonKey === hk ? t.horizon.profile : null;
        seq++;
        set({ running: true, progress: 0, hits: [], total: 0, elapsedMs: 0, error: null, pin: w.pin });
        const req: FinderRequest = { id: seq, pin: w.pin, heightAboveGroundM: w.pinHeightM + EYE_HEIGHT_M, query: finderQuery(f, w.tz), horizon };
        finderWorker().postMessage(req);
      },
      cancel: () => {
        seq++;
        set({ running: false });
      },
      fromTarget: () => {
        const w = worldStore.getState();
        if (!w.pin2) return;
        const tol = get().settings.toleranceDeg;
        const az = bearingDeg(w.pin, w.pin2);
        const alt = targetAngleDeg();
        get().update({ azFromDeg: normalizeBearing(az - tol), azToDeg: normalizeBearing(az + tol), altMinDeg: alt - tol, altMaxDeg: alt + tol });
      },
      fromFrame: () => {
        const w = worldStore.getState();
        const c = compositionStore.getState();
        const fov = frameFov(sensorById(c.sensorId, gearStore.getState().cameras), effectiveOptics(c).focalMm, c.orientation);
        const aim = aimFor(c, w, w.pin2 ? targetAngleDeg() : null);
        get().update({
          azFromDeg: normalizeBearing(aim.azimuthDeg - fov.hDeg / 2),
          azToDeg: normalizeBearing(aim.azimuthDeg + fov.hDeg / 2),
          altMinDeg: aim.elevationDeg - fov.vDeg / 2,
          altMaxDeg: aim.elevationDeg + fov.vDeg / 2
        });
      },
      toCsv: (units) => {
        const { hits, pin, settings } = get();
        const w = worldStore.getState();
        const s = settingsStore.getState();
        const time = (ms: number) => formatTime(ms, w.tz, s.hour12, true);
        const at = pin ?? w.pin;
        const rows = [
          `# ${settings.body} from ${at.lat.toFixed(5)}, ${at.lng.toFixed(5)} (eye ${height(w.pinHeightM + EYE_HEIGHT_M, units)}), ${w.tz}`,
          'Date,Best,Start,End,Minutes,Azimuth,Altitude,Sun altitude,Moon altitude,Moon illumination,Moon phase',
          ...hits.map((h) =>
            [
              formatDate(h.bestMs, w.tz),
              time(h.bestMs),
              time(h.startMs),
              time(h.endMs),
              ((h.endMs - h.startMs) / 60_000).toFixed(1),
              h.azDeg.toFixed(2),
              h.altDeg.toFixed(2),
              h.sunAltDeg.toFixed(2),
              h.moonAltDeg.toFixed(2),
              h.moonIllumination.toFixed(3),
              h.moonPhase
            ]
              .map((v) => (v.includes(',') ? `"${v}"` : v))
              .join(',')
          )
        ];
        return rows.join('\n');
      }
    }),
    {
      name: 'scape.finder',
      partialize: (s) => ({ settings: s.settings })
    }
  )
);

export const useFinder = finderStore;
