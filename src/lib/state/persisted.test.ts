import { describe, expect, it } from 'vitest';
import { LightMode } from '@core/astro/lightSource';
import { MoonRule } from '@core/astro/milkyWay';
import { SkyBody } from '@core/astro/bodies';
import { SkyFilter, type FinderSettings } from '@core/astro/finder';
import { Units } from '@core/format';
import { CoordFormat } from '@core/geo/coords';
import { CocRule, Orientation, Teleconverter } from '@core/optics/fov';
import { CloudLayer } from '@core/weather/layer';
import { WeatherModel } from '@core/weather/models';
import { BasemapKind, PmFlavor } from '@data/basemaps';
import { HeatMode } from '@workers/align.protocol';
import { alignStore, mergeAlign, type AlignSettings } from './align';
import { AimLock, compositionStore, mergeComposition, migrateComposition, type Composition } from './composition';
import { finderStore, mergeFinder, type PersistedFinder } from './finder';
import { gearStore, mergeGear, migrateGear, type PersistedGear } from './gear';
import { ClickMode, mergeSettings, migrateSettings, settingsStore, type Settings } from './settings';
import { MarkersView, mergeUi, migrateUi, PanelTab, uiStore, type PersistedUi } from './ui';
import { mergeWeather, weatherStore, type PersistedWeather } from './weather';
import { mergeWorld, worldStore, type PersistedWorld } from './world';

const stored = (v: unknown) => JSON.parse(JSON.stringify(v)) as Record<string, unknown>;

/**
 * Every field of `valid` survives a storage round trip, as does `current`; each field alone,
 * garbled or missing, falls back to `current`'s.
 */
function expectChecked<S extends object, P extends object>(merge: (saved: unknown, current: S) => S, current: S, valid: P): void {
  const keys = Object.keys(valid) as (keyof P & keyof S)[];
  const pick = (s: object) => Object.fromEntries(keys.map((k) => [k, (s as Record<string, unknown>)[k as string]]));
  expect(pick(merge(stored(valid), current))).toEqual(stored(valid));
  expect(pick(merge(stored(pick(current)), current))).toEqual(pick(current));
  expect(pick(merge(undefined, current))).toEqual(pick(current));
  for (const k of keys) {
    for (const junk of [{ junk: true }, -Infinity, NaN]) {
      expect(merge({ ...stored(valid), [k]: junk }, current)[k], `${String(k)} = ${String(junk)}`).toEqual(current[k]);
    }
    const { [k]: _gone, ...rest } = stored(valid);
    expect(merge(rest, current)[k], `${String(k)} missing`).toEqual(current[k]);
  }
}

const settings: Required<Settings> = {
  units: Units.Imperial,
  hour12: false,
  coordFormat: CoordFormat.DMS,
  basemapId: 'mine',
  customBasemaps: [{ id: 'mine', name: 'Mine', kind: BasemapKind.Raster, url: 'https://t/{z}/{x}/{y}.png', maxzoom: 17, flavor: PmFlavor.Dark }],
  offlineFlavor: PmFlavor.Black,
  goldenAltitude: 4,
  cocRule: CocRule.PixelPitch,
  showEventLines: false,
  showLiveLines: false,
  showShadow: false,
  shadowObjectHeightM: 2,
  showGc: false,
  showBuildings: false,
  showSunShadows: false,
  lightSource: LightMode.Moon,
  timelineDetail: true,
  clickMode: ClickMode.Target,
  terrain: false,
  terrainHorizon: false,
  horizonRangeKm: 50,
  showHillshade: true,
  terrain3d: true,
  showLightPollution: true,
  showSatellite: true,
  weather: false,
  showDayNight: true,
  dayNightOpacity: 0.3,
  showElevation: true,
  elevationOpacity: 0.3,
  showSlope: true,
  slopeOpacity: 0.3,
  showAspect: true,
  aspectOpacity: 0.3,
  mwSunMaxAlt: -12,
  mwGcMinAlt: 5,
  mwMoonRule: MoonRule.Ignore,
  mwMoonMaxIllum: 0.5
};

const composition: Required<Composition> = {
  sensorId: 'apsc',
  focalMm: 85,
  fNumber: 2.8,
  teleconverters: [Teleconverter.X14, Teleconverter.X20],
  orientation: Orientation.Portrait,
  azimuthDeg: 120,
  elevationDeg: 5,
  aimLock: AimLock.Gc,
  showFov: false,
  fovRangeM: 2000,
  focusDistM: 30,
  panoTotalDeg: 180,
  panoOverlap: 0.4,
  showGrid: true,
  showMarkers: false,
  showPaths: false,
  showStars: false,
  showConstellations: true,
  showStarNames: false,
  showMilkyWay: false,
  showSun: false,
  showMoon: false,
  showTrails: true,
  trailMinutes: 60,
  showRadiants: false,
  showBuildings: false,
  showSunShadows: false,
  showRainbow: true,
  lensId: 'custom:lens'
};

const gear: Required<PersistedGear> = {
  cameras: [{ id: 'custom:cam', name: 'Cam', widthMm: 36, heightMm: 24, pixelsWide: 9504, mount: 'E' }],
  lenses: [{ id: 'custom:lens', name: 'Zoom', minMm: 100, maxMm: 400, maxAperture: 4.5, maxApertureLong: 5.6, mount: 'E' }],
  focalPresets: [24, 70, 200],
  kits: [{ id: 'k', name: 'Kit', cameraId: 'custom:cam', lensId: null }]
};

const finderSettings: Required<FinderSettings> = {
  body: SkyBody.Moon,
  azFromDeg: 10,
  azToDeg: 20,
  altMinDeg: -1,
  altMaxDeg: 5,
  startIso: '2026-01-02',
  days: 30,
  sky: SkyFilter.BlueHour,
  moonIllumMin: 0.2,
  moonIllumMax: 0.8,
  moonDown: true,
  weekdays: [0, 6],
  aboveTerrain: false,
  toleranceDeg: 1
};

const align: Required<AlignSettings> = {
  mode: HeatMode.Time,
  body: SkyBody.Moon,
  toleranceDeg: 2,
  windowMin: 30,
  rangeKm: 10,
  cells: 96,
  opacity: 0.5,
  offsetAzDeg: 1,
  offsetAltDeg: -1,
  minAltAboveTerrainDeg: 2
};

const world: Required<PersistedWorld> = {
  pin: { lat: 35.36, lng: 138.73, digits: { lat: 2, lng: 2 } },
  pinHeightM: 2,
  pin2: { lat: 35.4, lng: 138.8 },
  pin2HeightM: 30,
  pin2HeightAuto: true,
  pin2HeightFrom: 'Tower',
  tz: 'Asia/Tokyo',
  tzAuto: false,
  view: { center: { lat: 35, lng: 138 }, zoom: 9, bearing: 30, pitch: 45 },
  live: false,
  time: 1_700_000_000_000
};

describe('stored state is checked field by field', () => {
  it('settings', () => expectChecked(mergeSettings, settingsStore.getState(), settings));
  it('composition', () => expectChecked(mergeComposition, { ...compositionStore.getState(), aimLock: AimLock.Free }, composition));
  it('gear', () => expectChecked(mergeGear, gearStore.getState(), gear));
  it('align', () => expectChecked(mergeAlign, alignStore.getState(), align));
  it('world', () => expectChecked(mergeWorld, worldStore.getState(), world));
  it('ui', () => {
    const ui: Required<PersistedUi> = { panelTabs: { map: PanelTab.Sky, viewfinder: PanelTab.Find }, panelCollapsed: true, panelTall: true, markersView: MarkersView.Models, cloudLegendOpen: true };
    expectChecked(mergeUi, uiStore.getState(), ui);
  });
  it('weather', () => {
    const weather: Required<PersistedWeather> = { model: WeatherModel.Gfs, layer: CloudLayer.Off, lastLayer: CloudLayer.High, opacity: 0.4 };
    expectChecked(mergeWeather, weatherStore.getState(), weather);
  });
  it('finder', () => {
    const f: PersistedFinder = { settings: finderSettings };
    expectChecked(mergeFinder, finderStore.getState(), f);
  });
});

describe('nested stored records', () => {
  it('drops a bad lens, camera or kit and keeps the rest', () => {
    const g = mergeGear({ ...stored(gear), lenses: [...gear.lenses, { id: 'x', name: 'Bad', minMm: 'wide' }, null], kits: [{ id: 'k2' }, ...gear.kits] }, gearStore.getState());
    expect(g.lenses).toEqual(gear.lenses);
    expect(g.kits).toEqual(gear.kits);
  });

  it('takes the default for one bad finder setting and keeps the others', () => {
    const f = mergeFinder({ settings: { ...finderSettings, sky: 'Twilight', weekdays: [1, 9, 'Mon'], startIso: 'soon' } }, finderStore.getState());
    expect(f.settings).toEqual({ ...finderSettings, sky: SkyFilter.Any, weekdays: [1], startIso: finderStore.getState().settings.startIso });
  });

  it('keeps a point without precision and refuses an unknown zone', () => {
    const w = mergeWorld({ ...stored(world), pin: { lat: 1, lng: 2, digits: 'x' }, tz: 'Mars/Olympus' }, worldStore.getState());
    expect(w.pin).toEqual({ lat: 1, lng: 2 });
    expect(w.tz).toBe(worldStore.getState().tz);
  });

  it('drops a bad custom basemap', () => {
    const s = mergeSettings({ customBasemaps: [{ id: 'a', name: 'A', kind: 'vector', url: 'u' }, settings.customBasemaps[0]] }, settingsStore.getState());
    expect(s.customBasemaps).toEqual(settings.customBasemaps);
  });
});

describe('removed enum values fall back', () => {
  it('in settings, ui, weather and align', () => {
    expect(mergeSettings({ ...stored(settings), cocRule: 'zeiss', units: 'nautical' }, settingsStore.getState())).toMatchObject({ cocRule: settingsStore.getState().cocRule, units: settingsStore.getState().units, hour12: false });
    expect(mergeUi({ markersView: 'Plans' }, uiStore.getState()).markersView).toBe(uiStore.getState().markersView);
    expect(mergeWeather({ model: 'icon_old', layer: 'Smoke', lastLayer: 'Off' }, weatherStore.getState())).toMatchObject({ model: weatherStore.getState().model, layer: weatherStore.getState().layer, lastLayer: weatherStore.getState().lastLayer });
    expect(mergeAlign({ ...stored(align), mode: 'Shadow' }, alignStore.getState())).toMatchObject({ mode: alignStore.getState().mode, body: SkyBody.Moon });
  });

  it('frees an unknown aim lock, as before', () => {
    expect(mergeComposition({ aimLock: 'Venus' }, compositionStore.getState()).aimLock).toBe(AimLock.Free);
  });
});

describe('old versions go through migrate, then the checks', () => {
  it('settings v0', () => {
    const s = mergeSettings(migrateSettings({ clickMovesPin: false, coordFormat: CoordFormat.DD, units: 'imperial', goldenAltitude: 'six' }, 0), settingsStore.getState());
    expect(s).toMatchObject({ clickMode: ClickMode.Off, coordFormat: CoordFormat.Signed, units: Units.Imperial, goldenAltitude: settingsStore.getState().goldenAltitude });
    expect(s).not.toHaveProperty('clickMovesPin');
  });

  it('composition v0', () => {
    const c = mergeComposition(migrateComposition({ teleconverter: 2, aimAtTarget: true, focalMm: -5 }, 0), compositionStore.getState());
    expect(c).toMatchObject({ teleconverters: [Teleconverter.X20], aimLock: AimLock.Target, focalMm: compositionStore.getState().focalMm });
  });

  it('gear v0', () => {
    const g = mergeGear(migrateGear({ cameras: 'none', focalPresets: [12, 'x'] }, 0), gearStore.getState());
    expect(g.cameras).toEqual([]);
    expect(g.focalPresets[0]).toBe(12);
  });

  it('ui v1', () => {
    expect(mergeUi(migrateUi({ panelTab: 'Night', panelCollapsed: 'yes' }, 1), uiStore.getState())).toMatchObject({ panelTabs: { map: PanelTab.Sky }, panelCollapsed: uiStore.getState().panelCollapsed });
  });

  it('migrations survive a non-object blob', () => {
    for (const blob of [null, 'x', 7, [1]]) {
      expect(mergeSettings(migrateSettings(blob, 0), settingsStore.getState()).units).toBe(settingsStore.getState().units);
      expect(mergeComposition(migrateComposition(blob, 0), compositionStore.getState()).teleconverters).toEqual([]);
      expect(mergeGear(migrateGear(blob, 0), gearStore.getState()).lenses).toEqual([]);
      expect(mergeUi(migrateUi(blob, 1), uiStore.getState()).panelTabs.map).toBe(PanelTab.Now);
    }
  });
});
