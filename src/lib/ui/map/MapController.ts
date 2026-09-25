import {
  GeolocateControl,
  LngLatBounds,
  Map as MaplibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  type GeoJSONSource,
  type ExpressionSpecification,
  type ImageSource,
  type MapMouseEvent
} from 'maplibre-gl';
import { shallow } from 'zustand/shallow';
import { makeObserver, SkyBody } from '@core/astro/bodies';
import { lightAt } from '@core/astro/lightSource';
import { position } from '@core/astro/positions';
import { bboxFromCorners, type Bbox } from '@core/geo/bbox';
import { linesShiftPx } from '@core/drift';
import { lod2Credits, type Lod2Source } from '@core/lod2/regions';
import { modelHeightAt } from '@core/model/heightAt';
import { rowsCentre, seedModel } from '@core/model/seed';
import { buildingLayerIds, heightFromFeatures } from '@core/geo/buildingHeight';
import { formatLngLat } from '@core/geo/coords';
import { bearingDeg, destination, distanceM, EARTH_RADIUS_M, type LngLat } from '@core/geo/geodesy';
import { cellOf, gridCorners } from '@core/geo/grid';
import { frameOf, maskCorners, maskFrame, maskPixels, maskRect, MOON_SHADOW_RGB, SHADOW_RGB, type MaskRect } from '@core/geo/shadowMask';
import { depthOfField } from '@core/optics/dof';
import { cocMm, effectiveOptics, focalForFovMm, fovDeg, frameMm, sensorPixels, tcFactor } from '@core/optics/fov';
import '@data/maplibre';
import { isDarkBasemap, styleFor, type Basemap } from '@data/basemaps';
import { buildingsSource } from '@data/buildingsProtocol';
import { ensureDemProtocol } from '@data/demProtocol';
import { GEOID_DOWNLOAD_URL, geoidCredit } from '@data/geoid';
import { demSourceSpec, ensureDemSourceType } from '@data/demSource';
import { ensurePmtilesProtocol } from '@data/pmtiles';
import { DEM_TILE_TEMPLATE, TERRAIN_ATTRIBUTION, TERRAIN_MAX_ZOOM, TERRAIN_TILE_SIZE } from '@data/terrainTiles';
import { alignStore } from '@state/align';
import { buildingsStore, buildingHeightAt, buildingRowsAt, requestShadowMask, suppressedBuildingIds, type ShadowMaskField } from '@state/buildings';
import { aimFor, compositionStore } from '@state/composition';
import { dayDataStore } from '@state/dayData';
import { gearStore, sensorById, zoomPatch } from '@state/gear';
import { lightProbeStore } from '@state/lightProbe';
import { mapStatusStore } from '@state/mapStatus';
import { markersStore } from '@state/markers';
import { modelsStore } from '@state/models';
import { currentBasemap, offlineStore } from '@state/offline';
import { ClickMode, settingsStore } from '@state/settings';
import { pinSiteHeightM, profileKeyFor, terrainStore } from '@state/terrain';
import { MarkersView, OrbitPivot, PanelTab, uiStore } from '@state/ui';
import { planTime, worldStore } from '@state/world';
import { HeatMode, type AlignCandidate } from '@workers/align.protocol';
import { CloudOverlay } from './cloudOverlay';
import { paintHeat } from './heat';
import { ClickModeControl } from './ClickModeControl';
import { LONG_PRESS_MS, LongPress, type Pt } from './longPress';
import { MapLayers } from './mapLayers';
import { MapMenu } from './mapMenu';
import { ModelDrawer } from './ModelDrawer';
import { eventLines, FovKind, fovCone, geodeticLine, LiveLineKind, liveLines, markerFeatures } from './overlays';
import { installTrackpadWheel } from './wheelZoom';

const EVENTS_SRC = 'sky-events';
const LIVE_SRC = 'sky-live';
const GEO_SRC = 'geodetic';
const FOV_SRC = 'fov';
const MARKERS_SRC = 'markers';
const REGION_SRC = 'region';
const HEAT_SRC = 'heat';
const HEAT_LAYER = 'heat';
// Stand-in until the first grid arrives; an image source needs a URL up front.
const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
// MapLibre wants separate DEM sources for hillshade and 3D terrain; same tiles, cached once by the browser.
const DEM_SRC = 'terrain-dem';
const HILL_SRC = 'terrain-dem-hillshade';
// NASA GIBS, public domain; a coarse (zoom ≤ 8) proxy for light pollution.
const LIGHTS_SRC = 'night-lights';
const LIGHTS_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png';
const LIGHTS_ATTRIBUTION = 'Night lights: <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a>, VIIRS Black Marble 2016';
// Scape's own Overture buildings, replacing whatever the basemap draws.
const BLD_SRC = 'overture-buildings';
const BLD_LAYER = 'overture-building';
const BLD_PART_LAYER = 'overture-building-part';
const SHADOW_SRC = 'sun-shadow';
const SHADOW_LAYER = 'sun-shadow';
// An empty, invisible source that only carries the mask's LoD2 credit while the mask uses it.
const SHADOW_CREDIT_SRC = 'sun-shadow-credit';
const BLD_MIN_ZOOM = 14;
/** Below this the mask's cell outgrows the coarsest DEM zoom and its tile count runs away: 12 tiles here, 108 two zooms out. */
const SHADOW_MIN_ZOOM = 8;
const SHADOW_OPACITY = 0.35;
/** Shadow edges ramp over this depth below the ceiling; the sun's own width is about this soft. */
const SHADOW_SOFT_M = 5;
/** Several triggers fire together and the build is a worker round trip, so coalesce them. */
const SHADOW_DEBOUNCE_MS = 180;
const D2R = Math.PI / 180;
const M_PER_DEG_LAT = (EARTH_RADIUS_M * Math.PI) / 180;
/** Upper bounds on a shadow's reach, sizing the mask rect past the viewport edge. */
const TALLEST_BUILDING_M = 600;
const SHADOW_MAX_LENGTH_M = 5_000;
/** Relief that can throw a shadow into the view from outside it — an Alpine wall, not Everest. */
const TALLEST_TERRAIN_M = 3_000;
const SHADOW_MAX_TERRAIN_M = 40_000;
const BLD_HEIGHT: ExpressionSpecification = ['coalesce', ['get', 'height'], ['*', ['get', 'num_floors'], 3], 5];
const BLD_BASE: ExpressionSpecification = ['coalesce', ['get', 'min_height'], 0];
const NOT_UNDERGROUND: ExpressionSpecification = ['!=', ['get', 'is_underground'], true];
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const PIN_COLOR = '#e5322d';
const PIN2_COLOR = '#8fd18c';
const PROBE_COLOR = '#ffc94a';
const MAX_PITCH = 60;
// Read at load: the route rewrites the URL without it.
const ZOOM_PROBE = new URLSearchParams(location.search).has('zoomprobe');
// Short of 90° so the ground and the lines drawn on it stay in view.
const ORBIT_MAX_PITCH = 80;
const ORBIT_PITCH = 65;
const ORBIT_DEG_PER_S = 6;
const ORBIT_STEP_DEG = 90;
const FOV_COLOR = '#5aa9ff';
const REGION_COLOR = '#5aa9ff';
const DEFAULT_FOV_RANGE_M = 5_000;

/** Rectangle ring for a draft region; a box crossing the antimeridian runs past +180. */
function regionFeatures(b: Bbox | null): GeoJSON.FeatureCollection {
  if (!b) return EMPTY;
  const east = b.west <= b.east ? b.east : b.east + 360;
  const ring = [[b.west, b.south], [east, b.south], [east, b.north], [b.west, b.north], [b.west, b.south]];
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] };
}

/** Snapped to a lattice of `stepM`, so a small pan asks the worker for the grid it already has. */
function snapPoint(p: LngLat, stepM: number): LngLat {
  const stepLat = stepM / M_PER_DEG_LAT;
  const lat = Math.round(p.lat / stepLat) * stepLat;
  const stepLng = stepM / Math.max(1, M_PER_DEG_LAT * Math.cos(lat * D2R));
  return { lat, lng: Math.round(p.lng / stepLng) * stepLng };
}

const samePoint = (a: LngLat | null, b: LngLat | null) => a === b || (!!a && !!b && a.lat === b.lat && a.lng === b.lng);
const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

function handleElement(title: string, cls: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `fov-handle ${cls}`;
  el.title = title;
  return el;
}

/** Owns the MapLibre instance and keeps its overlays in sync with the stores. No React inside. */
export class MapController {
  private map: MaplibreMap;
  private pin: Marker;
  private pin2: Marker | null = null;
  private probe: Marker | null = null;
  private candidate: Marker | null = null;
  private fovHandle: Marker | null = null;
  private fovEdgeHandle: Marker | null = null;
  private scale: ScaleControl;
  private unsubs: (() => void)[] = [];
  private rayM = 50_000;
  private styleReady = false;
  private basemapKey = '';
  private dragging = false;
  private drawingRegion = false;
  private drawStart: LngLat | null = null;
  private draftBefore: Bbox | null = null;
  private dragging2 = false;
  private draggingFov = false;
  private shadowTimer: ReturnType<typeof setTimeout> | 0 = 0;
  private live: { src: GeoJSONSource; data: GeoJSON.FeatureCollection } | null = null;
  private painted: { src: ImageSource; mask: ShadowMaskField } | null = null;
  private drawer: ModelDrawer;
  private clouds: CloudOverlay;
  private menu: MapMenu;
  /** Fingers on the map; the browser's own long-press contextmenu is left to `LongPress`. */
  private touches = 0;
  /** Overture feature ids a visible model stands in for. */
  private hiddenIds: string[] = [];
  /** Body behind the mask on screen; the smoke test reads it. */
  lightBody: SkyBody | null = null;

  constructor(container: HTMLElement) {
    const w = worldStore.getState();
    const s = settingsStore.getState();
    ensurePmtilesProtocol();
    ensureDemProtocol();
    void ensureDemSourceType();
    const bm = currentBasemap();
    this.basemapKey = `${bm.id}|${bm.flavor ?? ''}`;

    this.map = new MaplibreMap({
      container,
      style: styleFor(bm),
      center: [w.view.center.lng, w.view.center.lat],
      zoom: w.view.zoom,
      maxPitch: MAX_PITCH,
      // Box zoom takes every shift-press, which would swallow Shift-click.
      boxZoom: false,
      attributionControl: { compact: true }
    });
    this.map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    this.map.addControl(new GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'top-right');
    this.map.addControl(new ClickModeControl(), 'top-right');
    this.scale = new ScaleControl({ unit: s.units });
    this.map.addControl(this.scale, 'bottom-left');
    this.unsubs.push(installTrackpadWheel(this.map));
    if (import.meta.env.DEV) Object.assign(window, { __scapeMap: this.map, __scapeMapCtl: this });
    if (import.meta.env.DEV || ZOOM_PROBE) {
      let off: (() => void) | undefined;
      let gone = false;
      void import('./zoomProbe').then((p) => {
        if (!gone) off = p.installZoomProbe(this.map, ZOOM_PROBE);
      });
      this.unsubs.push(() => {
        gone = true;
        off?.();
      });
    }

    this.pin = this.makeMarker({ at: w.pin, color: PIN_COLOR, scale: 1 }, (p) => worldStore.getState().setPin(p), (d) => (this.dragging = d));
    this.syncPin2(w.pin2);
    this.drawer = new ModelDrawer(this.map, () => [BLD_LAYER, BLD_PART_LAYER]);
    this.clouds = new CloudOverlay(this.map);

    this.map.on('click', (e: MapMouseEvent) => {
      if (this.drawingRegion || this.drawer.onClick(e)) return;
      const p = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      const lp = lightProbeStore.getState();
      if (lp.picking) return lp.setPoint(p);
      const al = alignStore.getState();
      if ((al.mode === HeatMode.Align || al.mode === HeatMode.Time) && al.result && cellOf(al.result.grid, p)) return al.pick(p);
      if (this.map.getLayer('markers-circle') && this.map.queryRenderedFeatures(e.point, { layers: ['markers-circle'] }).length) return;
      const models = modelsStore.getState();
      if (models.picking) return this.modelBuildingAt(p);
      if (models.importPick) return this.importOnBuildingAt(p);
      if (markersStore.getState().placing || e.originalEvent.altKey) return this.addMarkerAt(p);
      if (e.originalEvent.shiftKey) return this.setTargetFromMap(p);
      const mode = settingsStore.getState().clickMode;
      if (mode === ClickMode.Camera) worldStore.getState().setPin(p);
      else if (mode === ClickMode.Target) this.setTargetFromMap(p);
    });
    this.menu = new MapMenu(this.map.getContainer(), this.map.getCanvasContainer());
    this.map.on('contextmenu', (e: MapMouseEvent) => {
      if (!this.touches && !this.drawingRegion) this.openMenu(e.point);
    });
    this.map.on('movestart', () => this.menu.close());
    this.installLongPress();
    this.map.on('mousedown', (e: MapMouseEvent) => {
      if (!this.drawingRegion) return;
      this.drawStart = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      offlineStore.getState().setDraft(bboxFromCorners(this.drawStart, this.drawStart));
    });
    this.map.on('mousemove', (e: MapMouseEvent) => {
      if (!this.drawingRegion || !this.drawStart) return;
      offlineStore.getState().setDraft(bboxFromCorners(this.drawStart, { lng: e.lngLat.lng, lat: e.lngLat.lat }));
    });
    this.map.on('mouseup', (e: MapMouseEvent) => {
      if (!this.drawingRegion || !this.drawStart) return;
      const bbox = bboxFromCorners(this.drawStart, { lng: e.lngLat.lng, lat: e.lngLat.lat });
      this.drawStart = null;
      const o = offlineStore.getState();
      o.setDraft(bbox);
      o.setDrawing(false);
    });
    for (const type of ['mousedown', 'touchstart', 'wheel'] as const) {
      this.map.on(type, () => {
        const u = uiStore.getState();
        if (u.orbit !== OrbitPivot.Off && u.orbitSpin) u.setOrbit(u.orbit, false);
      });
    }
    window.addEventListener('keydown', this.onKeyDown);
    this.unsubs.push(() => window.removeEventListener('keydown', this.onKeyDown));

    this.map.on('click', 'markers-circle', (e) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (!id) return;
      markersStore.getState().select(id);
      uiStore.getState().setPanelTab(PanelTab.Markers);
    });
    this.map.on('mouseenter', 'markers-circle', () => (this.map.getCanvas().style.cursor = 'pointer'));
    this.map.on('mouseleave', 'markers-circle', () => (this.map.getCanvas().style.cursor = ''));
    this.map.on('error', (e) => {
      const msg = e.error?.message || 'Map error';
      mapStatusStore.getState().setError(msg);
      console.warn('[scape] map error:', msg);
    });
    this.map.on('style.load', () => {
      this.styleReady = true;
      mapStatusStore.getState().setError(null);
      this.addOverlayLayers();
      this.applyTerrain();
      this.applyNightLights();
      this.applyBuildings();
      this.drawer.addLayers(this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id);
      this.clouds.addLayer(this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id);
      this.applyShadows();
      this.updateRay();
      this.renderAll();
    });
    this.map.on('moveend', (e) => {
      if ((e as { orbit?: boolean }).orbit) this.orbitStep();
      this.updateRay();
      this.renderAll();
      this.scheduleShadows();
      const c = this.map.getCenter();
      worldStore.getState().setView({ center: { lng: c.lng, lat: c.lat }, zoom: this.map.getZoom() });
    });

    const layers = new MapLayers(this.map, HILL_SRC, (id) => this.ensureDem(id));
    this.unsubs.push(
      () => layers.dispose(),
      () => clearTimeout(this.shadowTimer),
      () => this.drawer.dispose(),
      () => this.clouds.dispose(),
      modelsStore.subscribe((st) => st.rev, () => void this.refreshSuppression()),
      buildingsStore.subscribe((st) => st.shadowMask, () => this.paintShadowMask()),
      worldStore.subscribe(
        (st) => st.pin,
        (pin) => {
          if (!this.dragging) this.pin.setLngLat([pin.lng, pin.lat]);
          this.renderLive();
          this.renderGeodetic();
          this.renderFov();
          this.scheduleShadows();
        },
        { equalityFn: samePoint }
      ),
      worldStore.subscribe(
        (st) => st.pin2,
        (p) => {
          this.syncPin2(p);
          this.renderLive();
          this.renderGeodetic();
          this.renderFov();
        },
        { equalityFn: samePoint }
      ),
      worldStore.subscribe((st) => st.time, () => this.renderLive(true)),
      // Live, shadows follow the minute: a clock showing seconds must not rebuild them.
      worldStore.subscribe(planTime, () => {
        // A live tick needs no debounce, and a timer per tick keeps an idle page awake.
        if (worldStore.getState().live) this.requestShadows();
        else this.scheduleShadows();
      }),
      worldStore.subscribe((st) => st.pinHeightM, () => this.renderLive()),
      worldStore.subscribe((st) => st.pin2HeightM, () => this.renderLive()),
      worldStore.subscribe(
        (st) => st.fly,
        (f) => {
          if (!f) return;
          const opts = { center: [f.center.lng, f.center.lat] as [number, number], zoom: f.zoom };
          if (f.animate) this.map.flyTo({ ...opts, duration: 900 });
          else this.map.jumpTo(opts);
        }
      ),
      dayDataStore.subscribe(() => this.renderEvents()),
      terrainStore.subscribe((st) => st.profile, () => this.renderGeodetic()),
      compositionStore.subscribe(() => this.renderFov()),
      gearStore.subscribe(() => this.renderFov()),
      markersStore.subscribe((st) => [st.markers, st.selectedId] as const, () => this.renderMarkers(), { equalityFn: shallow }),
      markersStore.subscribe((st) => st.placing, (on) => (this.map.getCanvas().style.cursor = on ? 'crosshair' : '')),
      modelsStore.subscribe((st) => st.picking || st.importPick, (on) => (this.map.getCanvas().style.cursor = on ? 'crosshair' : '')),
      settingsStore.subscribe(
        (st) => [st.basemapId, st.customBasemaps, st.offlineFlavor] as const,
        () => this.setBasemap(currentBasemap()),
        { equalityFn: shallow }
      ),
      offlineStore.subscribe((st) => st.archives, () => this.setBasemap(currentBasemap()), { equalityFn: shallow }),
      offlineStore.subscribe((st) => st.draft, () => this.renderRegion()),
      offlineStore.subscribe((st) => st.drawing, (on) => this.setDrawingRegion(on)),
      offlineStore.subscribe((st) => st.viewSeq, () => this.draftFromView()),
      settingsStore.subscribe(
        (st) => [st.showEventLines, st.showLiveLines, st.showShadow, st.showGc, st.shadowObjectHeightM] as const,
        () => this.renderAll(),
        { equalityFn: shallow }
      ),
      settingsStore.subscribe(
        (st) => [st.terrain, st.showHillshade, st.terrain3d] as const,
        () => this.applyTerrain(),
        { equalityFn: shallow }
      ),
      settingsStore.subscribe((st) => st.showBuildings, () => this.applyBuildings()),
      settingsStore.subscribe((st) => st.showSunShadows, () => this.applyShadows()),
      settingsStore.subscribe((st) => st.lightSource, () => this.scheduleShadows()),
      settingsStore.subscribe((st) => st.cocRule, () => this.renderFov()),
      settingsStore.subscribe((st) => st.showLightPollution, () => this.applyNightLights()),
      settingsStore.subscribe((st) => st.units, (u) => this.scale.setUnit(u)),
      alignStore.subscribe((st) => [st.result, st.opacity] as const, () => this.renderHeat(), { equalityFn: shallow }),
      alignStore.subscribe((st) => st.candidate, (c) => this.syncCandidate(c)),
      uiStore.subscribe((st, prev) => {
        if (st.orbit !== prev.orbit || st.orbitSpin !== prev.orbitSpin) this.applyOrbit();
      }),
      lightProbeStore.subscribe((st, prev) => {
        if (st.point !== prev.point) this.syncProbe(st.point);
        if (st.picking !== prev.picking) this.map.getCanvas().style.cursor = st.picking ? 'crosshair' : '';
      })
    );

    this.showBothPins();
  }

  /** Returning from the viewfinder must show the camera and target locations together. */
  private showBothPins() {
    const { pin, pin2 } = worldStore.getState();
    if (!pin2) return;
    const a: [number, number] = [pin.lng, pin.lat];
    const b: [number, number] = [pin2.lng, pin2.lat];
    const view = this.map.getBounds();
    if (view.contains(a) && view.contains(b)) return;
    this.map.fitBounds(new LngLatBounds(a, a).extend(b), {
      padding: { top: 80, right: 80, bottom: 60, left: 60 },
      maxZoom: 15,
      duration: 0
    });
  }

  /** Draggable marker whose drags reach the store at most once per frame. */
  private makeMarker(opts: { at: LngLat; color?: string; scale?: number; element?: HTMLElement }, commit: (p: LngLat, final: boolean) => void, setDragging: (d: boolean) => void) {
    const m = new Marker({ draggable: true, color: opts.color, scale: opts.scale, element: opts.element }).setLngLat([opts.at.lng, opts.at.lat]).addTo(this.map);
    let raf = 0;
    const commitPos = (final: boolean) => {
      const ll = m.getLngLat();
      commit({ lng: ll.lng, lat: ll.lat }, final);
    };
    m.on('dragstart', () => setDragging(true));
    m.on('drag', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        commitPos(false);
      });
    });
    m.on('dragend', () => {
      cancelAnimationFrame(raf);
      raf = 0;
      setDragging(false);
      commitPos(true);
    });
    this.unsubs.push(() => cancelAnimationFrame(raf));
    return m;
  }

  private syncPin2(p: LngLat | null) {
    if (!p) {
      this.pin2?.remove();
      this.pin2 = null;
      return;
    }
    if (!this.pin2) {
      this.pin2 = this.makeMarker(
        { at: p, color: PIN2_COLOR, scale: 0.9 },
        (q, final) => (final ? this.setTargetFromMap(q) : worldStore.getState().setPin2(q)),
        (d) => (this.dragging2 = d)
      );
      return;
    }
    if (!this.dragging2) this.pin2.setLngLat([p.lng, p.lat]);
  }

  /** Seeds a Drawn model from the Overture building under `p` and opens it in the editor. */
  private modelBuildingAt(p: LngLat) {
    const models = modelsStore.getState();
    models.setPicking(false);
    void buildingRowsAt(p).then(async (rows) => {
      const m = rows ? seedModel(rows, `Model ${models.models.length + 1}`) : null;
      if (!m) {
        modelsStore.setState({ pickError: 'No Overture building there.' });
        return;
      }
      await modelsStore.getState().save(m);
      modelsStore.getState().select(m.id);
    });
    const ui = uiStore.getState();
    ui.setPanelTab(PanelTab.Markers);
    ui.setMarkersView(MarkersView.Models);
  }

  /** Hands the import sheet the centre of the Overture building under `p`. */
  private importOnBuildingAt(p: LngLat) {
    modelsStore.getState().setImportPick(false);
    void buildingRowsAt(p).then((rows) => {
      const c = rows && rowsCentre(rows);
      modelsStore.setState(c ? { importAt: c } : { pickError: 'No Overture building there.' });
    });
  }

  private orbitPivot(): LngLat {
    const w = worldStore.getState();
    return uiStore.getState().orbit === OrbitPivot.Target && w.pin2 ? w.pin2 : w.pin;
  }

  private orbitGroundM(): number | null {
    const t = terrainStore.getState();
    return uiStore.getState().orbit === OrbitPivot.Target && worldStore.getState().pin2 ? t.pin2GroundM : t.pinGroundM;
  }

  /** Tilts onto the pivot when the orbit starts, then hands over to the spin. */
  private applyOrbit() {
    const { orbit } = uiStore.getState();
    if (orbit === OrbitPivot.Off) {
      this.map.stop();
      this.map.setCenterClampedToGround(true);
      this.map.setMaxPitch(MAX_PITCH);
      return;
    }
    const s = settingsStore.getState();
    if (!s.terrain3d) s.update({ terrain3d: true });
    this.map.setMaxPitch(ORBIT_MAX_PITCH);
    const p = this.orbitPivot();
    this.map.setCenterClampedToGround(false);
    this.map.easeTo({ center: [p.lng, p.lat], pitch: Math.max(this.map.getPitch(), ORBIT_PITCH), duration: 800 }, { orbit: true });
  }

  private orbitStep() {
    const { orbit, orbitSpin } = uiStore.getState();
    if (orbit === OrbitPivot.Off || !orbitSpin || this.map.isMoving()) return;
    const p = this.orbitPivot();
    // The camera turns about the centre's height, which the map's own terrain sample can get far wrong at a summit.
    this.map.jumpTo({ elevation: this.orbitGroundM() ?? this.map.queryTerrainElevation([p.lng, p.lat]) ?? 0 });
    this.map.rotateTo(this.map.getBearing() + ORBIT_STEP_DEG, { duration: (ORBIT_STEP_DEG / ORBIT_DEG_PER_S) * 1000, easing: (t) => t, freezeElevation: true }, { orbit: true });
  }

  private syncProbe(p: LngLat | null) {
    if (!p) {
      this.probe?.remove();
      this.probe = null;
      return;
    }
    if (!this.probe) this.probe = this.makeMarker({ at: p, color: PROBE_COLOR, scale: 0.7 }, (q, final) => final && lightProbeStore.getState().setPoint(q), () => {});
    else this.probe.setLngLat([p.lng, p.lat]);
  }

  private addMarkerAt(p: LngLat) {
    const ms = markersStore.getState();
    ms.setPlacing(false);
    void ms.save(p).then((m) => ms.select(m.id));
    uiStore.getState().setPanelTab(PanelTab.Markers);
  }

  /** `at` is in map container pixels. */
  private openMenu(at: Pt) {
    const ll = this.map.unproject([at.x, at.y]);
    const p = { lng: ll.lng, lat: ll.lat };
    const coords = formatLngLat(p, settingsStore.getState().coordFormat);
    this.menu.open(at, [
      { label: 'Camera here', run: () => worldStore.getState().setPin(p) },
      { label: 'Target here', run: () => this.setTargetFromMap(p) },
      { label: 'Add marker', run: () => this.addMarkerAt(p) },
      { label: 'Copy coordinates', detail: coords, run: () => void navigator.clipboard.writeText(coords).catch((err) => console.warn('[scape] copy failed:', err)) }
    ]);
  }

  /** Touch stand-in for the right-click menu; its timer only runs while one finger is down. */
  private installLongPress() {
    const el = this.map.getCanvasContainer();
    const lp = new LongPress();
    let timer: ReturnType<typeof setTimeout> | 0 = 0;
    const disarm = () => {
      clearTimeout(timer);
      timer = 0;
    };
    const points = (e: TouchEvent) => {
      const r = el.getBoundingClientRect();
      return [...e.touches].map((t) => ({ x: t.clientX - r.left, y: t.clientY - r.top }));
    };
    const start = (e: TouchEvent) => {
      this.touches = e.touches.length;
      disarm();
      if (this.drawingRegion || !lp.down(points(e))) return;
      timer = setTimeout(() => {
        timer = 0;
        const at = lp.elapse();
        if (at) this.openMenu(at);
      }, LONG_PRESS_MS);
    };
    const move = (e: TouchEvent) => {
      if (lp.move(points(e))) disarm();
    };
    const end = (e: TouchEvent) => {
      this.touches = e.touches.length;
      disarm();
      // The lift after a long-press must not also tap the map or the menu now under the finger.
      if (lp.up(e.touches.length) && e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('touchcancel', end, { passive: false });
    this.unsubs.push(disarm, () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    });
  }

  /** A target placed through the map also picks up the height of the building under it. */
  private setTargetFromMap(p: LngLat) {
    worldStore.getState().setPin2(p);
    this.applyBuildingHeight(p, true);
  }

  /** Leaves a height the user typed alone; a height the map filled follows the new target. */
  private applyBuildingHeight(p: LngLat, retry: boolean) {
    const w = worldStore.getState();
    if (!w.pin2HeightAuto && w.pin2HeightM > 0) return;
    const fromModel = modelHeightAt(modelsStore.getState().models, p);
    if (fromModel) {
      w.setPin2Height(Math.round(fromModel.heightM), true, fromModel.model.name);
      return;
    }
    void buildingHeightAt(p).then((h) => {
      const now = worldStore.getState();
      // The target moved, or the user typed a height, while we waited.
      if (!samePoint(now.pin2, p) || (!now.pin2HeightAuto && now.pin2HeightM > 0)) return;
      if (h == null) this.applyRenderedHeight(p, retry);
      else worldStore.getState().setPin2Height(Math.round(h), true);
    });
  }

  /** Fallback when the buildings archive has nothing there: the height of the drawn basemap feature. */
  private applyRenderedHeight(p: LngLat, retry: boolean) {
    const w = worldStore.getState();
    const h = this.renderedHeightAt(p);
    if (h == null) {
      // The building layer may not be rendered yet; look again once the tiles have landed.
      if (retry) {
        this.map.once('idle', () => {
          if (samePoint(worldStore.getState().pin2, p)) this.applyRenderedHeight(p, false);
        });
      }
      else if (w.pin2HeightAuto) w.setPin2Height(0, false);
      return;
    }
    w.setPin2Height(Math.round(h), true);
  }

  private renderedHeightAt(p: LngLat): number | null {
    // Ours answer while the basemap's are hidden, and `building_part` is not a `building`
    // source-layer, so `buildingLayerIds` never finds it.
    const ids = new Set([...buildingLayerIds(this.map.getStyle()?.layers), BLD_LAYER, BLD_PART_LAYER]);
    const layers = [...ids].filter((id) => this.map.getLayer(id));
    if (!layers.length) return null;
    return heightFromFeatures(this.map.queryRenderedFeatures(this.map.project([p.lng, p.lat]), { layers }));
  }

  /** Escape leaves drawing mode and drops the half-drawn rectangle. */
  private onKeyDown = (e: KeyboardEvent) => {
    const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]');
    if (!typing && this.drawer.onKey(e)) return;
    if (e.key !== 'Escape' || !this.drawingRegion) return;
    if (this.drawStart) offlineStore.getState().setDraft(this.draftBefore);
    this.drawStart = null;
    offlineStore.getState().setDrawing(false);
  };

  private setDrawingRegion(on: boolean) {
    this.drawingRegion = on;
    this.map.getCanvas().style.cursor = on ? 'crosshair' : '';
    if (on) {
      this.draftBefore = offlineStore.getState().draft;
      this.map.dragPan.disable();
    } else {
      this.drawStart = null;
      this.map.dragPan.enable();
    }
  }

  private draftFromView() {
    const b = this.map.getBounds();
    offlineStore.getState().setDraft(bboxFromCorners({ lng: b.getWest(), lat: b.getSouth() }, { lng: b.getEast(), lat: b.getNorth() }));
  }

  private setBasemap(bm: Basemap) {
    const key = `${bm.id}|${bm.flavor ?? ''}`;
    if (key === this.basemapKey) return;
    this.basemapKey = key;
    this.styleReady = false;
    this.map.setStyle(styleFor(bm));
  }

  /** A font the current style can actually serve; symbol layers fail silently otherwise. */
  private labelFont(): string[] {
    for (const l of this.map.getStyle().layers) {
      if (l.type !== 'symbol') continue;
      const f = (l.layout as { 'text-font'?: unknown } | undefined)?.['text-font'];
      if (Array.isArray(f) && f.every((x) => typeof x === 'string')) return f as string[];
    }
    return ['Noto Sans Regular'];
  }

  private addOverlayLayers() {
    if (this.map.getSource(EVENTS_SRC)) return;
    this.map.addSource(HEAT_SRC, { type: 'image', url: BLANK_PNG, coordinates: [[-1, 1], [1, 1], [1, -1], [-1, -1]] });
    this.map.addLayer(
      {
        id: HEAT_LAYER,
        type: 'raster',
        source: HEAT_SRC,
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': alignStore.getState().opacity, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 }
      },
      this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id
    );
    this.map.addSource(EVENTS_SRC, { type: 'geojson', data: EMPTY });
    this.map.addSource(LIVE_SRC, { type: 'geojson', data: EMPTY });
    this.map.addSource(GEO_SRC, { type: 'geojson', data: EMPTY });
    this.map.addSource(FOV_SRC, { type: 'geojson', data: EMPTY });
    this.map.addSource(MARKERS_SRC, { type: 'geojson', data: EMPTY });
    this.map.addSource(REGION_SRC, { type: 'geojson', data: EMPTY });
    this.map.addLayer({ id: 'region-fill', type: 'fill', source: REGION_SRC, paint: { 'fill-color': REGION_COLOR, 'fill-opacity': 0.12 } });
    this.map.addLayer({
      id: 'region-line',
      type: 'line',
      source: REGION_SRC,
      paint: { 'line-color': REGION_COLOR, 'line-width': 2, 'line-dasharray': [2, 2] }
    });
    this.map.addLayer({
      id: 'fov-fill',
      type: 'fill',
      source: FOV_SRC,
      filter: ['==', ['get', 'kind'], FovKind.Fill],
      paint: { 'fill-color': FOV_COLOR, 'fill-opacity': 0.14 }
    });
    this.map.addLayer({
      id: 'fov-pano',
      type: 'line',
      source: FOV_SRC,
      filter: ['==', ['get', 'kind'], FovKind.Pano],
      paint: { 'line-color': FOV_COLOR, 'line-width': 1.5, 'line-opacity': 0.7, 'line-dasharray': [3, 3] }
    });
    this.map.addLayer({
      id: 'fov-axis',
      type: 'line',
      source: FOV_SRC,
      filter: ['==', ['get', 'kind'], FovKind.Axis],
      paint: { 'line-color': FOV_COLOR, 'line-width': 1, 'line-opacity': 0.6, 'line-dasharray': [2, 4] }
    });
    this.map.addLayer({
      id: 'fov-dof',
      type: 'line',
      source: FOV_SRC,
      filter: ['==', ['get', 'kind'], FovKind.Dof],
      paint: { 'line-color': '#f1c40f', 'line-width': 2, 'line-opacity': 0.9 }
    });
    this.map.addLayer({
      id: 'fov-edge',
      type: 'line',
      source: FOV_SRC,
      filter: ['==', ['get', 'kind'], FovKind.Edge],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': FOV_COLOR, 'line-width': 2 }
    });
    this.map.addLayer({
      id: 'geodetic-casing',
      type: 'line',
      source: GEO_SRC,
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#000', 'line-width': 6, 'line-opacity': 0.35 }
    });
    this.map.addLayer({
      id: 'geodetic-line',
      type: 'line',
      source: GEO_SRC,
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 3 }
    });
    this.map.addLayer({
      id: 'sky-events-line',
      type: 'line',
      source: EVENTS_SRC,
      filter: ['!=', ['get', 'terrain'], true],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.9 }
    });
    this.map.addLayer({
      id: 'sky-events-terrain-line',
      type: 'line',
      source: EVENTS_SRC,
      filter: ['==', ['get', 'terrain'], true],
      paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.9, 'line-dasharray': [1, 1.25] }
    });
    this.map.addLayer({
      id: 'sky-shadow-line',
      type: 'line',
      source: LIVE_SRC,
      filter: ['==', ['get', 'kind'], LiveLineKind.Shadow],
      paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [2, 2] }
    });
    this.map.addLayer({
      id: 'sky-live-line',
      type: 'line',
      source: LIVE_SRC,
      filter: ['==', ['get', 'kind'], LiveLineKind.Live],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 2 }
    });
    this.map.addLayer({
      id: 'markers-circle',
      type: 'circle',
      source: MARKERS_SRC,
      paint: {
        'circle-radius': ['case', ['get', 'selected'], 8, 6],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': ['case', ['get', 'selected'], '#ffffff', '#0f1216'],
        'circle-stroke-width': 2
      }
    });
    this.map.addLayer({
      id: 'markers-label',
      type: 'symbol',
      source: MARKERS_SRC,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': this.labelFont(),
        'text-size': 11,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-optional': true
      },
      paint: { 'text-color': '#e6edf3', 'text-halo-color': '#0f1216', 'text-halo-width': 1.2 }
    });
  }

  private ensureDem(id: string) {
    if (this.map.getSource(id)) return;
    this.map.addSource(
      id,
      demSourceSpec({
        tiles: [DEM_TILE_TEMPLATE],
        tileSize: TERRAIN_TILE_SIZE,
        encoding: 'terrarium',
        // The source's own maximum: where a region's coverage ends short of it, the loader
        // resamples from the deepest ancestor it has rather than leaving a hole.
        maxzoom: TERRAIN_MAX_ZOOM,
        attribution: TERRAIN_ATTRIBUTION
      })
    );
  }

  /** Hillshade sits under labels and our lines. */
  private applyTerrain() {
    if (!this.styleReady) return;
    const s = settingsStore.getState();
    const hill = s.terrain && s.showHillshade;
    const t3d = s.terrain && s.terrain3d;
    if (hill && !this.map.getLayer('hillshade')) {
      this.ensureDem(HILL_SRC);
      const before = this.map.getLayer(HEAT_LAYER) ? HEAT_LAYER : (this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id ?? 'fov-fill');
      this.map.addLayer(
        { id: 'hillshade', type: 'hillshade', source: HILL_SRC, paint: { 'hillshade-method': 'igor', 'hillshade-exaggeration': 0.6 } },
        before
      );
    } else if (!hill && this.map.getLayer('hillshade')) {
      this.map.removeLayer('hillshade');
    }
    if (t3d) this.ensureDem(DEM_SRC);
    this.map.setTerrain(t3d ? { source: DEM_SRC, exaggeration: 1 } : null);
  }

  /** The mask covers terrain as well as roofs, so it lives and dies with its own setting. */
  private applyShadows() {
    if (!this.styleReady) return;
    const on = settingsStore.getState().showSunShadows;
    if (on && !this.map.getLayer(SHADOW_LAYER)) {
      if (!this.map.getSource(SHADOW_SRC)) this.map.addSource(SHADOW_SRC, { type: 'image', url: BLANK_PNG, coordinates: [[-1, 1], [1, 1], [1, -1], [-1, -1]] });
      // Under the extrusions, whichever of the two went up first.
      const before = this.map.getLayer(BLD_LAYER) ? BLD_LAYER : this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
      this.map.addLayer(
        {
          id: SHADOW_LAYER,
          type: 'raster',
          source: SHADOW_SRC,
          layout: { visibility: 'none' },
          // A cross-fade would flicker on every rebuild; one raster composite cannot compound.
          paint: { 'raster-opacity': SHADOW_OPACITY, 'raster-fade-duration': 0 }
        },
        before
      );
    } else if (!on && this.map.getLayer(SHADOW_LAYER)) {
      this.map.removeLayer(SHADOW_LAYER);
      this.creditShadow([]);
    }
    this.scheduleShadows();
  }

  /** Our extrusions sit under the labels, over the shadow mask, and in place of the basemap's buildings. */
  private applyBuildings() {
    if (!this.styleReady) return;
    const on = settingsStore.getState().showBuildings;
    if (on && !this.map.getLayer(BLD_LAYER)) {
      if (!this.map.getSource(BLD_SRC)) this.map.addSource(BLD_SRC, buildingsSource(BLD_MIN_ZOOM));
      const before = this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
      const dark = isDarkBasemap(currentBasemap());
      const paint = {
        'fill-extrusion-color': dark ? '#5a6472' : '#c9ced6',
        'fill-extrusion-height': BLD_HEIGHT,
        'fill-extrusion-base': BLD_BASE,
        'fill-extrusion-opacity': 0.9,
        'fill-extrusion-vertical-gradient': true
      } as const;
      this.map.addLayer(
        {
          id: BLD_LAYER,
          type: 'fill-extrusion',
          source: BLD_SRC,
          'source-layer': 'building',
          minzoom: BLD_MIN_ZOOM,
          // Overture replaces a building that has parts with those parts; drawing both double-draws it.
          filter: this.buildingFilter(BLD_LAYER),
          paint
        },
        before
      );
      this.map.addLayer(
        { id: BLD_PART_LAYER, type: 'fill-extrusion', source: BLD_SRC, 'source-layer': 'building_part', minzoom: BLD_MIN_ZOOM, filter: this.buildingFilter(BLD_PART_LAYER), paint },
        before
      );
    } else if (!on) {
      for (const id of [BLD_LAYER, BLD_PART_LAYER]) if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    this.setBasemapBuildings(!on);
    this.scheduleShadows();
  }

  /** Overture replaces a building that has parts with those parts; drawing both double-draws it. A model hides what it stands in for. */
  private buildingFilter(layer: string): ExpressionSpecification {
    const own: ExpressionSpecification[] = layer === BLD_LAYER ? [['!=', ['get', 'has_parts'], true], NOT_UNDERGROUND] : [NOT_UNDERGROUND];
    return this.hiddenIds.length ? ['all', ...own, ['!', ['in', ['get', 'id'], ['literal', this.hiddenIds]]]] : ['all', ...own];
  }

  /** The worker knows which Overture rows the models suppress; the map hides the same ones. */
  private async refreshSuppression() {
    const ids = (await suppressedBuildingIds()) ?? this.hiddenIds;
    if (ids.length === this.hiddenIds.length && ids.every((id, i) => id === this.hiddenIds[i])) return;
    this.hiddenIds = ids;
    if (!this.styleReady) return;
    for (const id of [BLD_LAYER, BLD_PART_LAYER]) if (this.map.getLayer(id)) this.map.setFilter(id, this.buildingFilter(id));
  }

  /** The basemap's own extrusions are hidden, not removed: `applyRenderedHeight` still queries them. */
  private setBasemapBuildings(visible: boolean) {
    for (const id of buildingLayerIds(this.map.getStyle()?.layers)) {
      if (id === BLD_LAYER || id === BLD_PART_LAYER || !this.map.getLayer(id)) continue;
      this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  }

  /** The build is async through the worker, so it is debounced rather than driven per frame. */
  private scheduleShadows() {
    clearTimeout(this.shadowTimer);
    this.shadowTimer = setTimeout(() => this.requestShadows(), SHADOW_DEBOUNCE_MS);
  }

  private requestShadows() {
    if (!this.styleReady || !this.map.getLayer(SHADOW_LAYER)) return;
    const s = settingsStore.getState();
    if (!s.showSunShadows || this.map.getZoom() < SHADOW_MIN_ZOOM) return this.hideShadows();
    const w = worldStore.getState();
    const light = lightAt(s.lightSource, new Date(planTime(w)), makeObserver(w.pin, w.pinHeightM));
    this.lightBody = light?.body ?? null;
    if (!light) return this.hideShadows();
    const buildings = s.showBuildings && this.map.getZoom() >= BLD_MIN_ZOOM;
    const b = this.shadowBounds(light.altitudeDeg, light.azimuthDeg, buildings);
    const c = this.map.getCenter();
    // Sized against the true centre, then rebuilt around a snapped one so a small pan reuses the grid.
    const rough = this.shadowRect({ lng: c.lng, lat: c.lat }, b);
    const centre = snapPoint({ lng: c.lng, lat: c.lat }, rough.cellM * 16);
    const maxLenM = buildings ? SHADOW_MAX_LENGTH_M : SHADOW_MAX_TERRAIN_M;
    requestShadowMask(centre, this.shadowRect(centre, b), light.azimuthDeg, light.altitudeDeg, SHADOW_SOFT_M, buildings, maxLenM, this.finestMPerPx());
    // A toggle back on finds the store unchanged; the mask already in hand goes back up.
    this.paintShadowMask();
  }

  /** Ground metres per pixel along the bottom edge, where a pitched view is at its finest. */
  private finestMPerPx(): number {
    const { clientWidth: w, clientHeight: h } = this.map.getContainer();
    const a = this.map.unproject([w / 2 - 50, h - 1]);
    const b = this.map.unproject([w / 2 + 50, h - 1]);
    return Math.max(a.distanceTo(b) / 100, 1e-3);
  }

  private shadowRect(centre: LngLat, b: { west: number; east: number; south: number; north: number }): MaskRect {
    const f = maskFrame(centre);
    const sw = frameOf(f, { lng: b.west, lat: b.south });
    const ne = frameOf(f, { lng: b.east, lat: b.north });
    return maskRect(sw.e, ne.e, sw.n, ne.n);
  }

  private hideShadows() {
    // setLayoutProperty repaints even when the value is unchanged, and a sunless tick lands here.
    if (this.map.getLayer(SHADOW_LAYER) && this.map.getLayoutProperty(SHADOW_LAYER, 'visibility') !== 'none') this.map.setLayoutProperty(SHADOW_LAYER, 'visibility', 'none');
    this.creditShadow([]);
  }

  private creditShadow(ids: readonly Lod2Source[]) {
    if (!this.styleReady) return;
    const regions = lod2Credits(ids);
    const geoid = regions.some((r) => r.gsiGeoid) ? offlineStore.getState().geoid : null;
    const text = [...regions.map((r) => `<a href="${r.attributionUrl}">${r.attribution}</a>`), ...(geoid ? [`<a href="${GEOID_DOWNLOAD_URL}">${geoidCredit(geoid.version)}</a>`] : [])].join(' · ');
    const src = this.map.getSource(SHADOW_CREDIT_SRC);
    if ((src?.attribution ?? '') === text) return;
    if (src) {
      this.map.removeLayer(SHADOW_CREDIT_SRC);
      this.map.removeSource(SHADOW_CREDIT_SRC);
    }
    if (!text) return;
    this.map.addSource(SHADOW_CREDIT_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: text });
    this.map.addLayer({ id: SHADOW_CREDIT_SRC, type: 'fill', source: SHADOW_CREDIT_SRC, paint: { 'fill-opacity': 0 } });
  }

  /** Keeps the previous image on screen until the worker answers. */
  private paintShadowMask() {
    const m = buildingsStore.getState().shadowMask;
    const src = this.styleReady ? (this.map.getSource(SHADOW_SRC) as ImageSource | undefined) : undefined;
    if (!m || !src || !this.map.getLayer(SHADOW_LAYER)) return;
    // Every clock tick lands here; re-uploading an unchanged mask repaints the map for nothing.
    if (this.painted?.src === src && this.painted.mask === m && this.map.getLayoutProperty(SHADOW_LAYER, 'visibility') === 'visible') return;
    this.painted = { src, mask: m };
    const rgb = this.lightBody === SkyBody.Moon ? MOON_SHADOW_RGB : SHADOW_RGB;
    src.updateImage({ image: new ImageData(maskPixels(m.mask, m.nx, m.ny, rgb), m.nx, m.ny), coordinates: maskCorners(m.centre, m) });
    this.map.setLayoutProperty(SHADOW_LAYER, 'visibility', 'visible');
    this.creditShadow(m.lod2);
  }

  /**
   * The viewport grown up-sun by the longest shadow the caster in play could throw into it. One
   * 1024 px mask cannot hold a roof-sized cell and terrain's reach at once, so the pad follows the caster.
   */
  private shadowBounds(altDeg: number, azDeg: number, buildings: boolean): { west: number; east: number; south: number; north: number } {
    const b = this.map.getBounds();
    const tallest = buildings ? TALLEST_BUILDING_M : TALLEST_TERRAIN_M;
    const longest = buildings ? SHADOW_MAX_LENGTH_M : SHADOW_MAX_TERRAIN_M;
    const padM = Math.min(tallest / Math.tan(altDeg * D2R), longest);
    const north = Math.max(0, Math.cos(azDeg * D2R)) * padM;
    const south = Math.max(0, -Math.cos(azDeg * D2R)) * padM;
    const east = Math.max(0, Math.sin(azDeg * D2R)) * padM;
    const west = Math.max(0, -Math.sin(azDeg * D2R)) * padM;
    // The widest degree at any latitude the padded box reaches.
    const absLat = Math.min(89, Math.max(Math.abs(b.getNorth()), Math.abs(b.getSouth())) + padM / M_PER_DEG_LAT);
    const perLng = Math.max(1, M_PER_DEG_LAT * Math.cos(absLat * D2R));
    return { west: b.getWest() - west / perLng, east: b.getEast() + east / perLng, south: b.getSouth() - south / M_PER_DEG_LAT, north: b.getNorth() + north / M_PER_DEG_LAT };
  }

  private applyNightLights() {
    if (!this.styleReady) return;
    const on = settingsStore.getState().showLightPollution;
    if (on && !this.map.getLayer(LIGHTS_SRC)) {
      if (!this.map.getSource(LIGHTS_SRC)) this.map.addSource(LIGHTS_SRC, { type: 'raster', tiles: [LIGHTS_URL], tileSize: 256, maxzoom: 8, attribution: LIGHTS_ATTRIBUTION });
      const before = this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id ?? 'fov-fill';
      this.map.addLayer({ id: LIGHTS_SRC, type: 'raster', source: LIGHTS_SRC, paint: { 'raster-opacity': 0.75 } }, before);
    } else if (!on && this.map.getLayer(LIGHTS_SRC)) {
      this.map.removeLayer(LIGHTS_SRC);
    }
  }

  /** Lines run far past the viewport so they reach the map edge at any zoom. */
  private updateRay() {
    const b = this.map.getBounds();
    const c = this.map.getCenter();
    const corner: LngLat = { lng: b.getEast(), lat: b.getNorth() };
    this.rayM = Math.min(15_000_000, Math.max(2_000, distanceM({ lng: c.lng, lat: c.lat }, corner) * 3));
  }

  private renderAll() {
    this.renderEvents();
    this.renderLive();
    this.renderGeodetic();
    this.renderFov();
    this.renderMarkers();
    this.renderHeat();
    this.renderRegion();
  }

  private source(id: string): GeoJSONSource | undefined {
    return this.styleReady ? (this.map.getSource(id) as GeoJSONSource | undefined) : undefined;
  }

  private renderHeat() {
    const src = this.styleReady ? (this.map.getSource(HEAT_SRC) as ImageSource | undefined) : undefined;
    if (!src || !this.map.getLayer(HEAT_LAYER)) return;
    const a = alignStore.getState();
    if (!a.result) return void this.map.setLayoutProperty(HEAT_LAYER, 'visibility', 'none');
    src.updateImage({ url: paintHeat(a.result, { toleranceDeg: a.toleranceDeg, windowMin: a.windowMin }), coordinates: gridCorners(a.result.grid) });
    this.map.setPaintProperty(HEAT_LAYER, 'raster-opacity', a.opacity);
    this.map.setLayoutProperty(HEAT_LAYER, 'visibility', 'visible');
  }

  private syncCandidate(c: AlignCandidate | null) {
    if (!c) {
      this.candidate?.remove();
      this.candidate = null;
      return;
    }
    if (!this.candidate) {
      const el = document.createElement('div');
      el.className = 'map-candidate';
      el.title = 'Alignment candidate; click to clear';
      el.addEventListener('click', () => alignStore.getState().clearCandidate());
      this.candidate = new Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(this.map);
      return;
    }
    this.candidate.setLngLat([c.lng, c.lat]);
  }

  private renderEvents() {
    const src = this.source(EVENTS_SRC);
    if (!src) return;
    const s = settingsStore.getState();
    if (!s.showEventLines) return src.setData(EMPTY);
    const { pin } = worldStore.getState();
    const { events } = dayDataStore.getState();
    src.setData(eventLines(pin, events, this.rayM, { showGc: s.showGc }));
  }

  /** A clock tick redraws only once some ray has moved half a pixel since the last draw. */
  private renderLive(tick = false) {
    const src = this.source(LIVE_SRC);
    if (!src) return;
    const s = settingsStore.getState();
    let data: GeoJSON.FeatureCollection = EMPTY;
    if (s.showLiveLines) {
      const w = worldStore.getState();
      const obs = makeObserver(w.pin, pinSiteHeightM(w, terrainStore.getState()));
      const date = new Date(w.time);
      const pos = { Sun: position(SkyBody.Sun, date, obs), Moon: position(SkyBody.Moon, date, obs), Gc: position(SkyBody.Gc, date, obs) };
      data = liveLines(w.pin, pos, this.rayM, { showShadow: s.showShadow, showGc: s.showGc, shadowHeightM: s.shadowObjectHeightM, pin2: w.pin2, pin2HeightM: w.pin2HeightM });
    }
    if (tick && this.live?.src === src) {
      const c = this.map.getContainer();
      if (linesShiftPx(this.live.data, data, (p) => this.map.project(p), c.clientWidth, c.clientHeight) < 0.5) return;
    }
    this.live = { src, data };
    src.setData(data);
  }

  private renderGeodetic() {
    const src = this.source(GEO_SRC);
    if (!src) return;
    const w = worldStore.getState();
    if (!w.pin2) return src.setData(EMPTY);
    const t = terrainStore.getState();
    const fresh = t.profile && t.profileKey === profileKeyFor(w, settingsStore.getState());
    src.setData(geodeticLine(w.pin, w.pin2, fresh ? t.profile!.los.status : 'Unknown'));
  }

  private renderRegion() {
    this.source(REGION_SRC)?.setData(regionFeatures(offlineStore.getState().draft));
  }

  private renderMarkers() {
    const src = this.source(MARKERS_SRC);
    if (!src) return;
    const { markers, selectedId } = markersStore.getState();
    src.setData(markerFeatures(markers, selectedId));
  }

  /** Cone from the camera along the aim, with draggable tip (azimuth, length) and edge (focal length) handles. */
  private renderFov() {
    const src = this.source(FOV_SRC);
    if (!src) return;
    const w = worldStore.getState();
    const c = compositionStore.getState();
    if (!c.showFov) {
      src.setData(EMPTY);
      this.fovHandle?.remove();
      this.fovEdgeHandle?.remove();
      this.fovHandle = this.fovEdgeHandle = null;
      return;
    }
    const sensor = sensorById(c.sensorId, gearStore.getState().cameras);
    const frame = frameMm(sensor, c.orientation);
    const opt = effectiveOptics(c);
    const hfov = fovDeg(frame.w, opt.focalMm);
    const aim = aimFor(c, w, null);
    const targetM = w.pin2 ? distanceM(w.pin, w.pin2) : null;
    const rangeM = c.fovRangeM ?? targetM ?? DEFAULT_FOV_RANGE_M;
    const focusM = c.focusDistM ?? targetM;
    const dof = focusM ? depthOfField(opt.focalMm, opt.fNumber, cocMm(sensor, sensorPixels(sensor), settingsStore.getState().cocRule), focusM) : null;
    src.setData(fovCone(w.pin, aim.azimuthDeg, hfov, { rangeM, dofNearM: dof?.nearM, dofFarM: dof?.farM, panoDeg: c.panoTotalDeg }));

    if (this.draggingFov) return;
    const tip = destination(w.pin, aim.azimuthDeg, rangeM);
    const edge = destination(w.pin, aim.azimuthDeg - hfov / 2, rangeM);
    if (!this.fovHandle) {
      this.fovHandle = this.makeMarker(
        { at: tip, element: handleElement('Drag to aim the camera and set the cone length', 'tip') },
        (p) => {
          const cs = compositionStore.getState();
          const a = aimFor(cs, worldStore.getState(), null);
          cs.aim(bearingDeg(worldStore.getState().pin, p), a.elevationDeg);
          cs.update({ fovRangeM: Math.max(50, distanceM(worldStore.getState().pin, p)) });
        },
        (d) => (this.draggingFov = d)
      );
      this.fovEdgeHandle = this.makeMarker(
        { at: edge, element: handleElement('Drag to change the focal length', 'edge') },
        (p) => {
          const cs = compositionStore.getState();
          const ws = worldStore.getState();
          const a = aimFor(cs, ws, null);
          const half = Math.max(0.5, angleDiff(bearingDeg(ws.pin, p), a.azimuthDeg));
          const fr = frameMm(sensorById(cs.sensorId, gearStore.getState().cameras), cs.orientation);
          cs.update(zoomPatch(cs, focalForFovMm(fr.w, half * 2) / tcFactor(cs.teleconverters)));
        },
        (d) => (this.draggingFov = d)
      );
      return;
    }
    this.fovHandle.setLngLat([tip.lng, tip.lat]);
    this.fovEdgeHandle!.setLngLat([edge.lng, edge.lat]);
  }

  dispose() {
    for (const u of this.unsubs) u();
    this.menu.close();
    this.pin.remove();
    this.pin2?.remove();
    this.candidate?.remove();
    this.fovHandle?.remove();
    this.fovEdgeHandle?.remove();
    this.map.remove();
  }
}
