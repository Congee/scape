import {
  GeolocateControl,
  LngLatBounds,
  Map as MaplibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  type GeoJSONSource,
  type MapMouseEvent
} from 'maplibre-gl';
import { shallow } from 'zustand/shallow';
import { makeObserver, SkyBody } from '@core/astro/bodies';
import { lunarShadowCoverage } from '@core/astro/eclipse';
import { position } from '@core/astro/positions';
import { airDensity } from '@core/astro/refraction';
import { bboxFromCorners, type Bbox } from '@core/geo/bbox';
import { linesShiftPx } from '@core/drift';
import { modelHeightAt } from '@core/model/heightAt';
import { rowsCentre, rowsRings, seedModel } from '@core/model/seed';
import { buildingLayerIds, heightFromFeatures } from '@core/geo/buildingHeight';
import { atPixel, copyLngLat } from '@core/geo/coords';
import { isUrban, placeClass, type Place } from '@core/geo/parking';
import { distanceM, type LngLat } from '@core/geo/geodesy';
import { cellOf } from '@core/geo/grid';
import '@data/maplibre';
import { styleFor, type Basemap } from '@data/basemaps';
import { ensureDemProtocol } from '@data/demProtocol';
import { ensureDemSourceType } from '@data/demSource';
import { ensurePmtilesProtocol } from '@data/pmtiles';
import { alignStore } from '@state/align';
import { buildingHeightAt, buildingRowsAt } from '@state/buildings';
import { dayDataStore } from '@state/dayData';
import { lightProbeStore } from '@state/lightProbe';
import { mapStatusStore } from '@state/mapStatus';
import { markersStore } from '@state/markers';
import { modelsStore } from '@state/models';
import { currentBasemap, offlineStore } from '@state/offline';
import { ClickMode, settingsStore } from '@state/settings';
import { pinSiteHeightM, profileKeyFor, terrainStore } from '@state/terrain';
import { MarkersView, PanelTab, uiStore } from '@state/ui';
import { worldStore } from '@state/world';
import { HeatMode } from '@workers/align.protocol';
import { HALO, Ink } from '../inks';
import { BLD_LAYER, BLD_PART_LAYER, BuildingsLayer } from './buildingsLayer';
import { CloudOverlay } from './cloudOverlay';
import { ClickModeControl } from './ClickModeControl';
import { LONG_PRESS_MS, LongPress, type Pt } from './longPress';
import { HeatLayer } from './heatLayer';
import { draggableMarker, type MarkerOpts } from './draggableMarker';
import { FovOverlay } from './fovOverlay';
import { MapLayers } from './mapLayers';
import { EMPTY, samePoint } from './mapShared';
import { SatelliteLayer } from './satelliteLayer';
import { ensureDem, HILL_SRC, TerrainLayer } from './terrainLayer';
import { ShadowLayer } from './shadowLayer';
import { MapMenu } from './mapMenu';
import { ModelDrawer } from './ModelDrawer';
import { installMotionLod } from './motionLod';
import { NightLightsLayer } from './nightLightsLayer';
import { MAX_PITCH, Orbit } from './orbit';
import { eventLines, geodeticLine, LiveLineKind, liveLines, markerFeatures } from './overlays';
import { installTrackpadWheel } from './wheelZoom';

const EVENTS_SRC = 'sky-events';
const LIVE_SRC = 'sky-live';
const GEO_SRC = 'geodetic';
const MARKERS_SRC = 'markers';
// Below this the basemap drops town labels, so a spot can look rural when it is not.
const URBAN_MIN_ZOOM = 10;
const REGION_SRC = 'region';
const IMPORT_SRC = 'import-pick';
const PIN_COLOR = Ink.pin;
const PIN2_COLOR = Ink.pinTarget;
const PROBE_COLOR = Ink.edit;
// Read at load: the route rewrites the URL without it.
const ZOOM_PROBE = new URLSearchParams(location.search).has('zoomprobe');
const REGION_COLOR = Ink.edit;
const IMPORT_COLOR = Ink.edit;

/** Rectangle ring for a draft region; a box crossing the antimeridian runs past +180. */
function regionFeatures(b: Bbox | null): GeoJSON.FeatureCollection {
  if (!b) return EMPTY;
  const east = b.west <= b.east ? b.east : b.east + 360;
  const ring = [[b.west, b.south], [east, b.south], [east, b.north], [b.west, b.north], [b.west, b.south]];
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] };
}

/** Owns the MapLibre instance and keeps its overlays in sync with the stores. No React inside. */
export class MapController {
  private map: MaplibreMap;
  private pin: Marker;
  private pin2: Marker | null = null;
  private probe: Marker | null = null;
  private scale: ScaleControl;
  private unsubs: (() => void)[] = [];
  private rayM = 50_000;
  private styleReady = false;
  private basemapKey = '';
  private dragging = false;
  private drawingRegion = false;
  private importSeq = 0;
  private drawStart: LngLat | null = null;
  private draftBefore: Bbox | null = null;
  private dragging2 = false;
  private live: { src: GeoJSONSource; data: GeoJSON.FeatureCollection } | null = null;
  private drawer: ModelDrawer;
  private clouds: CloudOverlay;
  private menu: MapMenu;
  /** Fingers on the map; the browser's own long-press contextmenu is left to `LongPress`. */
  private touches = 0;
  private terrain: TerrainLayer;
  private buildings: BuildingsLayer;
  private shadows: ShadowLayer;
  private heat: HeatLayer;
  private orbit: Orbit;
  private fov: FovOverlay;
  private nightLights: NightLightsLayer;

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
      bearing: w.view.bearing ?? 0,
      pitch: w.view.pitch ?? 0,
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
    this.unsubs.push(installMotionLod(this.map));
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
      const p = this.picked(e.lngLat);
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
    this.map.getCanvas().addEventListener('keydown', (e) => {
      if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
      // Also stops the browser's own contextmenu event, so the menu opens once.
      e.preventDefault();
      const c = this.map.getCanvas();
      if (!this.drawingRegion) this.openMenu({ x: c.clientWidth / 2, y: c.clientHeight / 2 });
    });
    this.map.on('movestart', () => this.menu.close());
    this.installLongPress();
    this.map.on('mousedown', (e: MapMouseEvent) => {
      if (!this.drawingRegion) return;
      this.drawStart = this.picked(e.lngLat);
      offlineStore.getState().setDraft(bboxFromCorners(this.drawStart, this.drawStart));
    });
    this.map.on('mousemove', (e: MapMouseEvent) => {
      if (!this.drawingRegion || !this.drawStart) return;
      offlineStore.getState().setDraft(bboxFromCorners(this.drawStart, this.picked(e.lngLat)));
    });
    this.map.on('mouseup', (e: MapMouseEvent) => {
      if (!this.drawingRegion || !this.drawStart) return;
      const bbox = bboxFromCorners(this.drawStart, this.picked(e.lngLat));
      this.drawStart = null;
      const o = offlineStore.getState();
      o.setDraft(bbox);
      o.setDrawing(false);
    });
    this.orbit = new Orbit(this.map);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('online', this.onOnline);
    this.unsubs.push(() => this.orbit.dispose(), () => window.removeEventListener('keydown', this.onKeyDown), () => window.removeEventListener('online', this.onOnline));

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
      console.warn('[scape] map error:', msg);
      // A missing tile is a source with nothing there, not a failure.
      if ((e.error as { status?: number } | undefined)?.status === 404) return;
      mapStatusStore.getState().setError(msg, (e as { sourceId?: string }).sourceId ?? null);
    });
    this.map.on('data', (e) => {
      const st = mapStatusStore.getState();
      if (st.error && st.errorSource && e.dataType === 'source' && 'tile' in e && e.tile && 'sourceId' in e && e.sourceId === st.errorSource) st.setError(null);
    });
    this.map.on('style.load', () => {
      this.styleReady = true;
      mapStatusStore.getState().setError(null);
      this.addOverlayLayers();
      this.terrain.apply();
      this.nightLights.apply();
      this.buildings.apply();
      this.drawer.addLayers(this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id);
      this.clouds.addLayer(this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id);
      this.shadows.apply();
      this.updateRay();
      this.renderAll();
    });
    this.map.on('moveend', (e) => {
      if ((e as { orbit?: boolean }).orbit) this.orbit.step();
      this.updateRay();
      this.renderAll();
      const c = this.map.getCenter();
      worldStore.getState().setView({ center: { lng: c.lng, lat: c.lat }, zoom: this.map.getZoom(), bearing: this.map.getBearing(), pitch: this.map.getPitch() });
    });
    this.map.on('idle', () => this.senseUrban());

    const layers = new MapLayers(this.map, HILL_SRC, (id) => ensureDem(this.map, id));
    const satellite = new SatelliteLayer(this.map);
    this.unsubs.push(
      () => layers.dispose(),
      () => satellite.dispose(),
      () => this.drawer.dispose(),
      () => this.clouds.dispose(),
      mapStatusStore.subscribe((st) => st.retrySeq, () => this.retryTiles()),
      worldStore.subscribe(
        (st) => st.pin,
        (pin) => {
          if (!this.dragging) this.pin.setLngLat([pin.lng, pin.lat]);
          this.renderLive();
          this.renderGeodetic();
          this.senseUrban();
        },
        { equalityFn: samePoint }
      ),
      worldStore.subscribe(
        (st) => st.pin2,
        (p) => {
          this.syncPin2(p);
          this.renderLive();
          this.renderGeodetic();
        },
        { equalityFn: samePoint }
      ),
      worldStore.subscribe((st) => st.time, () => this.renderLive(true)),
      worldStore.subscribe((st) => st.pinHeightM, () => this.renderLive()),
      worldStore.subscribe((st) => st.pin2HeightM, () => this.renderLive()),
      worldStore.subscribe(
        (st) => st.fly,
        (f) => {
          if (!f) return;
          const opts = { center: [f.center.lng, f.center.lat] as [number, number], zoom: f.zoom, bearing: f.bearing, pitch: f.pitch };
          if (f.animate) this.map.flyTo({ ...opts, duration: 900 });
          else this.map.jumpTo(opts);
        }
      ),
      dayDataStore.subscribe(() => this.renderEvents()),
      terrainStore.subscribe((st) => st.profile, () => this.renderGeodetic()),
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
      modelsStore.subscribe((st) => st.importRings, () => this.renderImportPick()),
      offlineStore.subscribe((st) => st.drawing, (on) => this.setDrawingRegion(on)),
      settingsStore.subscribe(
        (st) => [st.showEventLines, st.showLiveLines, st.showShadow, st.showGc, st.shadowObjectHeightM] as const,
        () => this.renderAll(),
        { equalityFn: shallow }
      ),
      () => this.terrain.dispose(),
      () => this.buildings.dispose(),
      () => this.shadows.dispose(),
      () => this.heat.dispose(),
      () => this.nightLights.dispose(),
      () => this.fov.dispose()
    );
    // Settings listeners run in subscribe order, which decides the stacking of layers that share an anchor.
    this.terrain = new TerrainLayer(this.map, () => this.styleReady);
    this.buildings = new BuildingsLayer(this.map, () => this.styleReady, () => this.shadows.schedule());
    this.shadows = new ShadowLayer(this.map, () => this.styleReady);
    this.heat = new HeatLayer(this.map, () => this.styleReady);
    this.nightLights = new NightLightsLayer(this.map, () => this.styleReady);
    this.fov = new FovOverlay(this.map, () => this.styleReady);
    this.unsubs.push(
      settingsStore.subscribe((st) => st.units, (u) => this.scale.setUnit(u)),
      lightProbeStore.subscribe((st, prev) => {
        if (st.point !== prev.point) this.syncProbe(st.point);
        if (st.picking !== prev.picking) this.map.getCanvas().style.cursor = st.picking ? 'crosshair' : '';
      })
    );

    // Settings starts the drawing and then opens the map.
    if (offlineStore.getState().drawing) this.setDrawingRegion(true);
    this.showBothPins();
  }

  /** Body behind the mask on screen; the smoke test reads it. */
  get lightBody(): SkyBody | null {
    return this.shadows.lightBody;
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

  /** A point the user put on the map, at the precision one pixel resolves. */
  private picked(ll: { lng: number; lat: number }): LngLat {
    return atPixel(ll, this.map.getZoom());
  }

  /** Draggable marker whose drags reach the store at most once per frame. */
  private makeMarker(opts: MarkerOpts, commit: (p: LngLat, final: boolean) => void, setDragging: (d: boolean) => void) {
    const { marker, cancel } = draggableMarker(this.map, opts, commit, setDragging);
    this.unsubs.push(cancel);
    return marker;
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

  /** Chooses the Overture building under `p` for the import sheet, which confirms it. */
  private importOnBuildingAt(p: LngLat) {
    const seq = ++this.importSeq;
    void buildingRowsAt(p).then((rows) => {
      // A later click, or the sheet closing, wins over a slow read.
      if (seq !== this.importSeq || !modelsStore.getState().importPick) return;
      const c = rows && rowsCentre(rows);
      modelsStore.setState(rows && c ? { importAt: c, importRings: rowsRings(rows), pickError: null } : { pickError: 'No Overture building there.' });
    });
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
    const p = this.picked(this.map.unproject([at.x, at.y]));
    const coords = copyLngLat(p, settingsStore.getState().coordFormat);
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

  private recordView() {
    const b = this.map.getBounds();
    offlineStore.getState().setMapView(bboxFromCorners({ lng: b.getWest(), lat: b.getSouth() }, { lng: b.getEast(), lat: b.getNorth() }));
  }

  // MapLibre never refetches tiles that failed while offline.
  private onOnline = () => this.retryTiles();

  /** Refetches failed tiles, or the whole style when it never loaded. */
  private retryTiles() {
    if (!this.styleReady) {
      this.basemapKey = '';
      this.setBasemap(currentBasemap());
      return;
    }
    // refreshTiles leaves errored tiles stuck loading, so their sources start over.
    for (const tm of Object.values(this.map.style.tileManagers)) {
      if (tm.getIds().some((id) => tm.getTileByID(id)?.state === 'errored')) tm.clearTiles();
    }
    // oxlint-disable-next-line no-underscore-dangle -- marks sources dirty so cleared tiles refetch
    this.map._update();
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
    this.heat.addLayer(this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id);
    this.map.addSource(EVENTS_SRC, { type: 'geojson', data: EMPTY });
    this.map.addSource(LIVE_SRC, { type: 'geojson', data: EMPTY });
    this.map.addSource(GEO_SRC, { type: 'geojson', data: EMPTY });
    this.map.addSource(MARKERS_SRC, { type: 'geojson', data: EMPTY });
    this.map.addSource(REGION_SRC, { type: 'geojson', data: EMPTY });
    this.map.addSource(IMPORT_SRC, { type: 'geojson', data: EMPTY });
    this.map.addLayer({ id: 'import-pick-fill', type: 'fill', source: IMPORT_SRC, paint: { 'fill-color': IMPORT_COLOR, 'fill-opacity': 0.2 } });
    this.map.addLayer({ id: 'import-pick-casing', type: 'line', source: IMPORT_SRC, paint: { 'line-color': HALO, 'line-width': 6.5 } });
    this.map.addLayer({ id: 'import-pick-line', type: 'line', source: IMPORT_SRC, paint: { 'line-color': IMPORT_COLOR, 'line-width': 2.5 } });
    this.map.addLayer({ id: 'region-fill', type: 'fill', source: REGION_SRC, paint: { 'fill-color': REGION_COLOR, 'fill-opacity': 0.12 } });
    this.map.addLayer({ id: 'region-casing', type: 'line', source: REGION_SRC, paint: { 'line-color': HALO, 'line-width': 6 } });
    this.map.addLayer({
      id: 'region-line',
      type: 'line',
      source: REGION_SRC,
      paint: { 'line-color': REGION_COLOR, 'line-width': 2, 'line-dasharray': [2, 2] }
    });
    this.fov.addLayers();
    this.map.addLayer({
      id: 'geodetic-casing',
      type: 'line',
      source: GEO_SRC,
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': HALO, 'line-width': 6 }
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
        'circle-stroke-color': ['case', ['get', 'selected'], Ink.edit, Ink.bg],
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
      paint: { 'text-color': Ink.fg, 'text-halo-color': Ink.bg, 'text-halo-width': 1.2 }
    });
  }

  /** Whether the basemap's loaded place labels put the pin in town; only a close enough view can say no. */
  private senseUrban(): void {
    if (!this.styleReady || this.map.getZoom() < URBAN_MIN_ZOOM) return;
    const pin = worldStore.getState().pin;
    if (!this.map.getBounds().contains([pin.lng, pin.lat])) return;
    const places: Place[] = [];
    let vector = false;
    for (const [id, src] of Object.entries(this.map.getStyle().sources)) {
      if (src.type !== 'vector') continue;
      vector = true;
      for (const sourceLayer of ['place', 'places']) {
        for (const f of this.map.querySourceFeatures(id, { sourceLayer })) {
          const cls = f.geometry.type === 'Point' ? placeClass(sourceLayer, f.properties ?? {}) : null;
          if (cls) {
            const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
            places.push({ lng, lat, cls });
          }
        }
      }
    }
    if (vector) mapStatusStore.getState().setUrban(pin, isUrban(pin, places));
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
    this.fov.render();
    this.renderMarkers();
    this.heat.render();
    this.renderRegion();
    this.renderImportPick();
  }

  private source(id: string): GeoJSONSource | undefined {
    return this.styleReady ? (this.map.getSource(id) as GeoJSONSource | undefined) : undefined;
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
      data = liveLines(w.pin, pos, this.rayM, { airDensity: airDensity(obs.height), showShadow: s.showShadow, showGc: s.showGc, shadowHeightM: s.shadowObjectHeightM, pin2: w.pin2, pin2HeightM: w.pin2HeightM, moonUmbra: lunarShadowCoverage(date).umbra });
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

  private renderImportPick() {
    const rings = modelsStore.getState().importRings;
    this.source(IMPORT_SRC)?.setData(rings.length ? { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) } } : EMPTY);
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

  dispose() {
    for (const u of this.unsubs) u();
    this.menu.close();
    this.pin.remove();
    this.pin2?.remove();
    this.recordView();
    this.map.remove();
  }
}
