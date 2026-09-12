import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { bearingDeg, normalizeBearing } from '@core/geo/geodesy';
import { DEFAULT_SENSOR_ID, Orientation } from '@core/optics/fov';
import { worldStore, type WorldState } from './world';

/** Camera set-up shared by the map's FOV cone, the Frame panel and the viewfinder. */
export interface Composition {
  sensorId: string;
  focalMm: number;
  fNumber: number;
  orientation: Orientation;
  azimuthDeg: number;
  elevationDeg: number;
  /** Point at the target location instead of the stored azimuth/elevation. */
  aimAtTarget: boolean;
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
  /** Star trails over `trailMinutes` from the simulated time. */
  showTrails: boolean;
  trailMinutes: number;
  showRadiants: boolean;
  /** The map's 3D terrain, textured with the basemap, under the frame. */
  show3d: boolean;
  /** Lens from the gear list constraining focal length and aperture; null for free values. */
  lensId: string | null;
}

export interface CompositionState extends Composition {
  update(patch: Partial<Composition>): void;
  /** Point the camera manually; releases "aim at target". */
  aim(azimuthDeg: number, elevationDeg: number): void;
}

export const DEFAULT_COMPOSITION: Composition = {
  sensorId: DEFAULT_SENSOR_ID,
  focalMm: 35,
  fNumber: 8,
  orientation: Orientation.Landscape,
  azimuthDeg: 0,
  elevationDeg: 0,
  aimAtTarget: true,
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
  showTrails: false,
  trailMinutes: 30,
  showRadiants: true,
  show3d: true,
  lensId: null
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const compositionStore = create<CompositionState>()(
  subscribeWithSelector(
    persist(
      (set) => ({
        ...DEFAULT_COMPOSITION,
        update: (patch) => set(patch),
        aim: (azimuthDeg, elevationDeg) => set({ azimuthDeg: normalizeBearing(azimuthDeg), elevationDeg: clamp(elevationDeg, -89, 89), aimAtTarget: false })
      }),
      {
        name: 'scape.composition',
        partialize: ({ update: _u, aim: _a, ...rest }) => rest
      }
    )
  )
);

export const useComposition = compositionStore;

// Placing or moving the target means "frame it": the aim follows it again until the user aims elsewhere.
worldStore.subscribe(
  (s) => s.pin2,
  (pin2, prev) => {
    if (pin2 && (!prev || pin2.lat !== prev.lat || pin2.lng !== prev.lng)) compositionStore.setState({ aimAtTarget: true });
  }
);

export interface Aim {
  azimuthDeg: number;
  elevationDeg: number;
  /** True when the aim follows the target location. */
  locked: boolean;
}

/** Where the camera points; `targetAngleDeg` is the sightline elevation angle when known. */
export function aimFor(c: Pick<Composition, 'aimAtTarget' | 'azimuthDeg' | 'elevationDeg'>, w: Pick<WorldState, 'pin' | 'pin2'>, targetAngleDeg: number | null): Aim {
  if (c.aimAtTarget && w.pin2) return { azimuthDeg: bearingDeg(w.pin, w.pin2), elevationDeg: targetAngleDeg ?? 0, locked: true };
  return { azimuthDeg: c.azimuthDeg, elevationDeg: c.elevationDeg, locked: false };
}
