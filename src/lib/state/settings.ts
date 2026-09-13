import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { MoonRule } from '@core/astro/milkyWay';
import { Units } from '@core/format';
import { CoordFormat } from '@core/geo/coords';
import { CocRule } from '@core/optics/fov';
import { BUILTIN_BASEMAPS, DEFAULT_BASEMAP_ID, PmFlavor, type Basemap } from '@data/basemaps';

export interface Settings {
  units: Units;
  hour12: boolean;
  coordFormat: CoordFormat;
  basemapId: string;
  customBasemaps: Basemap[];
  /** Protomaps flavor used to style downloaded basemap archives. */
  offlineFlavor: PmFlavor;
  /** Sun altitude bounding the golden hour, degrees. */
  goldenAltitude: number;
  /** Circle-of-confusion rule behind the depth-of-field numbers. */
  cocRule: CocRule;
  showEventLines: boolean;
  showLiveLines: boolean;
  showShadow: boolean;
  /** Height of the object whose sun shadow is drawn, metres. */
  shadowObjectHeightM: number;
  showGc: boolean;
  /** Show transits, golden hour, terrain and Galactic Centre rows in the timeline. */
  timelineDetail: boolean;
  clickMovesPin: boolean;
  /** Fetch elevation data at all (Terrain Tiles). */
  terrain: boolean;
  /** Sweep the terrain horizon: chart curve and terrain rise/set. */
  terrainHorizon: boolean;
  horizonRangeKm: number;
  showHillshade: boolean;
  terrain3d: boolean;
  /** NASA VIIRS night-lights raster as a light-pollution proxy. */
  showLightPollution: boolean;
  /** Milky Way core window rules. */
  mwSunMaxAlt: number;
  mwGcMinAlt: number;
  mwMoonRule: MoonRule;
  mwMoonMaxIllum: number;
}

export interface SettingsState extends Settings {
  update(patch: Partial<Settings>): void;
  addBasemap(b: Basemap): void;
  removeBasemap(id: string): void;
}

export const DEFAULT_SETTINGS: Settings = {
  units: Units.Metric,
  hour12: true,
  coordFormat: CoordFormat.DD,
  basemapId: DEFAULT_BASEMAP_ID,
  customBasemaps: [],
  offlineFlavor: PmFlavor.Light,
  goldenAltitude: 6,
  cocRule: CocRule.Standard,
  showEventLines: true,
  showLiveLines: true,
  showShadow: true,
  shadowObjectHeightM: 1.8,
  showGc: true,
  timelineDetail: false,
  clickMovesPin: true,
  terrain: true,
  terrainHorizon: true,
  horizonRangeKm: 100,
  showHillshade: false,
  terrain3d: false,
  showLightPollution: false,
  mwSunMaxAlt: -18,
  mwGcMinAlt: 10,
  mwMoonRule: MoonRule.Down,
  mwMoonMaxIllum: 0.25
};

export const settingsStore = create<SettingsState>()(
  subscribeWithSelector(
    persist(
      (set) => ({
        ...DEFAULT_SETTINGS,
        update: (patch) => set(patch),
        addBasemap: (b) =>
          set((s) => ({ customBasemaps: [...s.customBasemaps.filter((x) => x.id !== b.id), b], basemapId: b.id })),
        removeBasemap: (id) =>
          set((s) => ({
            customBasemaps: s.customBasemaps.filter((x) => x.id !== id),
            basemapId: s.basemapId === id ? DEFAULT_BASEMAP_ID : s.basemapId
          }))
      }),
      {
        name: 'scape.settings',
        // Local-file basemaps only live for the session; their bytes are not persisted.
        partialize: ({ update: _u, addBasemap: _a, removeBasemap: _r, ...rest }) => ({
          ...rest,
          customBasemaps: rest.customBasemaps.filter((b) => !b.local)
        })
      }
    )
  )
);

export const useSettings = settingsStore;

export function findBasemap(id: string, custom: Basemap[], offline: Basemap[] = []): Basemap {
  return custom.find((b) => b.id === id) ?? offline.find((b) => b.id === id) ?? BUILTIN_BASEMAPS.find((b) => b.id === id) ?? BUILTIN_BASEMAPS[0];
}
