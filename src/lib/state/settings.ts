import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { LightMode } from '@core/astro/lightSource';
import { MoonRule } from '@core/astro/milkyWay';
import { Units } from '@core/format';
import { CoordFormat } from '@core/geo/coords';
import { CocRule } from '@core/optics/fov';
import { BUILTIN_BASEMAPS, DEFAULT_BASEMAP_ID, PmFlavor, type Basemap } from '@data/basemaps';

/** What a plain map click sets. Values are persisted in settings. */
export const ClickMode = { Camera: 'camera', Target: 'target', Off: 'off' } as const;
export type ClickMode = (typeof ClickMode)[keyof typeof ClickMode];

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
  /** Scape's own Overture building extrusions, from zoom 14. */
  showBuildings: boolean;
  /** Ground shadows those buildings cast at the timeline time. */
  showSunShadows: boolean;
  /** Which body casts those shadows, and the viewfinder's. */
  lightSource: LightMode;
  /** Show transits, golden hour, terrain and Galactic Centre rows in the timeline. */
  timelineDetail: boolean;
  clickMode: ClickMode;
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
  showBuildings: true,
  showSunShadows: true,
  lightSource: LightMode.Auto,
  timelineDetail: false,
  clickMode: ClickMode.Camera,
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

export const SETTINGS_VERSION = 1;

/** Version 0 stored `clickMovesPin`, where false meant a plain click did nothing. */
export function migrateSettings(state: unknown, version: number): Settings {
  const s = (state ?? {}) as Partial<Settings> & { clickMovesPin?: boolean };
  if (version >= SETTINGS_VERSION) return s as Settings;
  const { clickMovesPin, ...rest } = s;
  return { ...rest, clickMode: clickMovesPin === false ? ClickMode.Off : ClickMode.Camera } as Settings;
}

/** Exported so a test can check the store is wired to the migration, which storage-less Node hides. */
export const SETTINGS_PERSIST = {
  name: 'scape.settings',
  version: SETTINGS_VERSION,
  migrate: migrateSettings,
  // Local-file basemaps only live for the session; their bytes are not persisted.
  partialize: ({ update: _u, addBasemap: _a, removeBasemap: _r, ...rest }: SettingsState): Settings => ({
    ...rest,
    customBasemaps: rest.customBasemaps.filter((b) => !b.local)
  })
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
      SETTINGS_PERSIST
    )
  )
);

export const useSettings = settingsStore;

export function findBasemap(id: string, custom: Basemap[], offline: Basemap[] = []): Basemap {
  return custom.find((b) => b.id === id) ?? offline.find((b) => b.id === id) ?? BUILTIN_BASEMAPS.find((b) => b.id === id) ?? BUILTIN_BASEMAPS[0];
}
