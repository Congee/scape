import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { bearingDeg, normalizeBearing } from '@core/geo/geodesy';
import { clampBaseFocalMm, DEFAULT_SENSOR_ID, Orientation, tcFactor, type Teleconverter } from '@core/optics/fov';
import { worldStore, type WorldState } from './world';

/** What the camera follows; any manual aim switches to Free. */
export const AimLock = { Target: 'Target', Sun: 'Sun', Moon: 'Moon', Gc: 'Gc', Free: 'Free' } as const;
export type AimLock = (typeof AimLock)[keyof typeof AimLock];

const AIM_LOCKS: readonly unknown[] = Object.values(AimLock);

/** Unknown or missing values aim freely. */
export const parseAimLock = (v: unknown): AimLock => (AIM_LOCKS.includes(v) ? (v as AimLock) : AimLock.Free);

/** The lock a pre-`aimLock` record meant by its `aimAtTarget` flag. */
export const legacyAimLock = (aimAtTarget: unknown): AimLock => (aimAtTarget === true ? AimLock.Target : AimLock.Free);

/** Camera set-up shared by the map's FOV cone, the Frame panel and the viewfinder. */
export interface Composition {
  sensorId: string;
  focalMm: number;
  fNumber: number;
  /** Teleconverters stacked between body and lens; their product multiplies `focalMm` and `fNumber`. */
  teleconverters: readonly Teleconverter[];
  orientation: Orientation;
  azimuthDeg: number;
  elevationDeg: number;
  /** Target, a sky body, or Free for the stored azimuth/elevation; a body lock rewrites them as time passes. */
  aimLock: AimLock;
  showFov: boolean;
  /** Length of the cone drawn on the map; null follows the target distance. */
  fovRangeM: number | null;
  /** Focus distance for depth of field; null follows the target distance. */
  focusDistM: number | null;
  /** Panorama total angle; null hides the panorama tools. */
  panoTotalDeg: number | null;
  panoOverlap: number;
  showGrid: boolean;
  showMarkers: boolean;
  showPaths: boolean;
  showStars: boolean;
  showConstellations: boolean;
  showStarNames: boolean;
  showMilkyWay: boolean;
  /** Master switch for the sun in the picture: its disc, its label and its path. */
  showSun: boolean;
  /** Master switch for the moon in the picture; moonlight and sky brightness are unaffected. */
  showMoon: boolean;
  /** Star trails over `trailMinutes` from the simulated time. */
  showTrails: boolean;
  trailMinutes: number;
  showRadiants: boolean;
  /** OpenStreetMap building volumes rasterised into the frame. */
  showBuildings: boolean;
  /** Shadows the sun casts, from the terrain and from the buildings. */
  showSunShadows: boolean;
  /** Primary and secondary rainbow arcs around the antisolar point. */
  showRainbow: boolean;
  /** Lens from the gear list constraining focal length and aperture; null for free values. */
  lensId: string | null;
}

export interface CompositionState extends Composition {
  update(patch: Partial<Composition>): void;
  /** Point the camera manually; switches the lock to Free. */
  aim(azimuthDeg: number, elevationDeg: number): void;
}

export const DEFAULT_COMPOSITION: Composition = {
  sensorId: DEFAULT_SENSOR_ID,
  focalMm: 35,
  fNumber: 8,
  teleconverters: [],
  orientation: Orientation.Landscape,
  azimuthDeg: 0,
  elevationDeg: 0,
  aimLock: AimLock.Target,
  showFov: true,
  fovRangeM: null,
  focusDistM: null,
  panoTotalDeg: null,
  panoOverlap: 0.3,
  showGrid: false,
  showMarkers: true,
  showPaths: true,
  showStars: true,
  showConstellations: false,
  showStarNames: true,
  showMilkyWay: true,
  showSun: true,
  showMoon: true,
  showTrails: false,
  trailMinutes: 30,
  showRadiants: true,
  showBuildings: true,
  showSunShadows: true,
  showRainbow: false,
  lensId: null
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Elevation range of a manual aim, which a body lock shares. */
export const clampElevation = (deg: number) => clamp(deg, -89, 89);

/**
 * Patch for a manual aim, empty when either angle is non-finite. A NaN aim persists and then
 * silently degrades the mesh to nothing, with no error anywhere.
 */
export function aimPatch(azimuthDeg: number, elevationDeg: number): Partial<Composition> {
  if (!Number.isFinite(azimuthDeg) || !Number.isFinite(elevationDeg)) return {};
  return { azimuthDeg: normalizeBearing(azimuthDeg), elevationDeg: clampElevation(elevationDeg), aimLock: AimLock.Free };
}

export const COMPOSITION_VERSION = 2;

/** Version 0 stored one teleconverter multiplier, where 1 meant none; versions before 2 stored `aimAtTarget`. */
export function migrateComposition(state: unknown, version: number): Composition {
  let s = (state ?? {}) as Partial<Composition> & { teleconverter?: number; aimAtTarget?: unknown };
  if (version >= COMPOSITION_VERSION) return s as Composition;
  if (version < 1) {
    const { teleconverter, ...rest } = s;
    s = { ...rest, teleconverters: teleconverter && teleconverter > 1 ? [teleconverter as Teleconverter] : [] };
  }
  const { aimAtTarget, ...rest } = s;
  return { ...rest, aimLock: legacyAimLock(aimAtTarget) } as Composition;
}

export const compositionStore = create<CompositionState>()(
  subscribeWithSelector(
    persist(
      (set) => ({
        ...DEFAULT_COMPOSITION,
        // The base focal is re-capped here so no caller can leave focal × the teleconverters past the frame range.
        update: (patch) =>
          set((s) =>
            patch.focalMm == null && patch.teleconverters == null
              ? patch
              : { ...patch, focalMm: clampBaseFocalMm(patch.focalMm ?? s.focalMm, tcFactor(patch.teleconverters ?? s.teleconverters)) }
          ),
        aim: (azimuthDeg, elevationDeg) => set(aimPatch(azimuthDeg, elevationDeg))
      }),
      {
        name: 'scape.composition',
        version: COMPOSITION_VERSION,
        partialize: ({ update: _u, aim: _a, ...rest }) => rest,
        migrate: migrateComposition,
        merge: (persisted, current) => {
          const p = (persisted ?? {}) as Partial<Composition>;
          return { ...current, ...p, aimLock: 'aimLock' in p ? parseAimLock(p.aimLock) : current.aimLock };
        }
      }
    )
  )
);

export const useComposition = compositionStore;

// Placing or moving the target means "frame it", unless the user locked onto a sky body.
worldStore.subscribe(
  (s) => s.pin2,
  (pin2, prev) => {
    if (pin2 && (!prev || pin2.lat !== prev.lat || pin2.lng !== prev.lng) && compositionStore.getState().aimLock === AimLock.Free) compositionStore.setState({ aimLock: AimLock.Target });
  }
);

export interface Aim {
  azimuthDeg: number;
  elevationDeg: number;
  /** True when the aim follows the target or a sky body rather than the user's hand. */
  locked: boolean;
}

/** Where the camera points; `targetAngleDeg` is the sightline elevation angle when known. */
export function aimFor(c: Pick<Composition, 'aimLock' | 'azimuthDeg' | 'elevationDeg'>, w: Pick<WorldState, 'pin' | 'pin2'>, targetAngleDeg: number | null): Aim {
  if (c.aimLock === AimLock.Target) {
    if (w.pin2) return { azimuthDeg: bearingDeg(w.pin, w.pin2), elevationDeg: targetAngleDeg ?? 0, locked: true };
    return { azimuthDeg: c.azimuthDeg, elevationDeg: c.elevationDeg, locked: false };
  }
  // A body lock keeps the stored angles current (aimLock.ts).
  return { azimuthDeg: c.azimuthDeg, elevationDeg: c.elevationDeg, locked: c.aimLock !== AimLock.Free };
}
