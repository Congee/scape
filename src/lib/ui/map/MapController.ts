import {
  GeolocateControl,
  Map as MaplibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  type GeoJSONSource,
  type MapMouseEvent
} from 'maplibre-gl';
import { shallow } from 'zustand/shallow';
import { makeObserver } from '@core/astro/bodies';
import { position } from '@core/astro/positions';
import { distanceM, type LngLat } from '@core/geo/geodesy';
import '@data/maplibre';
import { styleFor, type Basemap } from '@data/basemaps';
import { ensurePmtilesProtocol } from '@data/pmtiles';
import { TERRAIN_ATTRIBUTION, TERRAIN_MAX_ZOOM, TERRAIN_TILE_URL } from '@data/terrainTiles';
import { dayDataStore } from '@state/dayData';
import { mapStatusStore } from '@state/mapStatus';
import { findBasemap, settingsStore } from '@state/settings';
import { profileKeyFor, terrainStore } from '@state/terrain';
import { worldStore } from '@state/world';
import { eventLines, geodeticLine, liveLines } from './overlays';

const EVENTS_SRC = 'sky-events';
const LIVE_SRC = 'sky-live';
const GEO_SRC = 'geodetic';
// MapLibre wants separate DEM sources for hillshade and 3D terrain; same tiles, cached once by the browser.
const DEM_SRC = 'terrain-dem';
const HILL_SRC = 'terrain-dem-hillshade';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const PIN_COLOR = '#e5322d';
const PIN2_COLOR = '#8fd18c';

const samePoint = (a: LngLat | null, b: LngLat | null) => a === b || (!!a && !!b && a.lat === b.lat && a.lng === b.lng);

/** Owns the MapLibre instance and keeps its overlays in sync with the stores. No React inside. */
export class MapController {
  private map: MaplibreMap;
  private pin: Marker;
  private pin2: Marker | null = null;
  private scale: ScaleControl;
  private unsubs: (() => void)[] = [];
  private rayM = 50_000;
  private styleReady = false;
  private basemapId = '';
  private dragging = false;
  private dragging2 = false;
  private dragRaf = 0;
  private drag2Raf = 0;

  constructor(container: HTMLElement) {
    const w = worldStore.getState();
    const s = settingsStore.getState();
    ensurePmtilesProtocol();
    const bm = findBasemap(s.basemapId, s.customBasemaps);
    this.basemapId = bm.id;

    this.map = new MaplibreMap({
      container,
      style: styleFor(bm),
      center: [w.view.center.lng, w.view.center.lat],
      zoom: w.view.zoom,
      maxPitch: 60,
      attributionControl: { compact: true }
    });
    this.map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    this.map.addControl(new GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'top-right');
    this.scale = new ScaleControl({ unit: s.units });
    this.map.addControl(this.scale, 'bottom-left');
    if (import.meta.env.DEV) (window as unknown as { __scapeMap?: MaplibreMap }).__scapeMap = this.map;

    this.pin = this.makeMarker(PIN_COLOR, w.pin, 1, (p) => worldStore.getState().setPin(p), (d) => (this.dragging = d), 'dragRaf');
    this.syncPin2(w.pin2);

    this.map.on('click', (e: MapMouseEvent) => {
      const p = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      if (e.originalEvent.shiftKey) worldStore.getState().setPin2(p);
      else if (settingsStore.getState().clickMovesPin) worldStore.getState().setPin(p);
    });
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
      this.updateRay();
      this.renderAll();
    });
    this.map.on('moveend', () => {
      this.updateRay();
      this.renderAll();
      const c = this.map.getCenter();
      worldStore.getState().setView({ center: { lng: c.lng, lat: c.lat }, zoom: this.map.getZoom() });
    });

    this.unsubs.push(
      worldStore.subscribe(
        (st) => st.pin,
        (pin) => {
          if (!this.dragging) this.pin.setLngLat([pin.lng, pin.lat]);
          this.renderLive();
          this.renderGeodetic();
        },
        { equalityFn: samePoint }
      ),
      worldStore.subscribe(
        (st) => st.pin2,
        (p) => {
          this.syncPin2(p);
          this.renderGeodetic();
        },
        { equalityFn: samePoint }
      ),
      worldStore.subscribe((st) => st.time, () => this.renderLive()),
      worldStore.subscribe((st) => st.pinHeightM, () => this.renderLive()),
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
      settingsStore.subscribe(
        (st) => [st.basemapId, st.customBasemaps] as const,
        ([id, custom]) => this.setBasemap(findBasemap(id, custom)),
        { equalityFn: shallow }
      ),
      settingsStore.subscribe(
        (st) => [st.showEventLines, st.showLiveLines, st.showShadow, st.showGc] as const,
        () => this.renderAll(),
        { equalityFn: shallow }
      ),
      settingsStore.subscribe(
        (st) => [st.terrain, st.showHillshade, st.terrain3d] as const,
        () => this.applyTerrain(),
        { equalityFn: shallow }
      ),
      settingsStore.subscribe((st) => st.units, (u) => this.scale.setUnit(u))
    );
  }

  /** Draggable marker whose drags reach the store at most once per frame. */
  private makeMarker(color: string, at: LngLat, scale: number, commit: (p: LngLat) => void, setDragging: (d: boolean) => void, rafKey: 'dragRaf' | 'drag2Raf') {
    const m = new Marker({ draggable: true, color, scale }).setLngLat([at.lng, at.lat]).addTo(this.map);
    const commitPos = () => {
      const ll = m.getLngLat();
      commit({ lng: ll.lng, lat: ll.lat });
    };
    m.on('dragstart', () => setDragging(true));
    m.on('drag', () => {
      if (this[rafKey]) return;
      this[rafKey] = requestAnimationFrame(() => {
        this[rafKey] = 0;
        commitPos();
      });
    });
    m.on('dragend', () => {
      setDragging(false);
      commitPos();
    });
    return m;
  }

  private syncPin2(p: LngLat | null) {
    if (!p) {
      this.pin2?.remove();
      this.pin2 = null;
      return;
    }
    if (!this.pin2) {
      this.pin2 = this.makeMarker(PIN2_COLOR, p, 0.9, (q) => worldStore.getState().setPin2(q), (d) => (this.dragging2 = d), 'drag2Raf');
      return;
    }
    if (!this.dragging2) this.pin2.setLngLat([p.lng, p.lat]);
  }

  private setBasemap(bm: Basemap) {
    if (bm.id === this.basemapId) return;
    this.basemapId = bm.id;
    this.styleReady = false;
    this.map.setStyle(styleFor(bm));
  }

  private addOverlayLayers() {
    if (this.map.getSource(EVENTS_SRC)) return;
    this.map.addSource(EVENTS_SRC, { type: 'geojson', data: EMPTY });
    this.map.addSource(LIVE_SRC, { type: 'geojson', data: EMPTY });
    this.map.addSource(GEO_SRC, { type: 'geojson', data: EMPTY });
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
      filter: ['==', ['get', 'kind'], 'shadow'],
      paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [2, 2] }
    });
    this.map.addLayer({
      id: 'sky-live-line',
      type: 'line',
      source: LIVE_SRC,
      filter: ['==', ['get', 'kind'], 'live'],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 2 }
    });
  }

  private ensureDem(id: string) {
    if (this.map.getSource(id)) return;
    this.map.addSource(id, {
      type: 'raster-dem',
      tiles: [TERRAIN_TILE_URL],
      tileSize: 256,
      encoding: 'terrarium',
      maxzoom: TERRAIN_MAX_ZOOM,
      attribution: TERRAIN_ATTRIBUTION
    });
  }

  /** Hillshade sits under labels and our lines. */
  private applyTerrain() {
    if (!this.styleReady) return;
    const s = settingsStore.getState();
    const hill = s.terrain && s.showHillshade;
    const t3d = s.terrain && s.terrain3d;
    if (hill && !this.map.getLayer('hillshade')) {
      this.ensureDem(HILL_SRC);
      const before = this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id ?? 'geodetic-casing';
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
  }

  private renderEvents() {
    if (!this.styleReady) return;
    const src = this.map.getSource(EVENTS_SRC) as GeoJSONSource | undefined;
    if (!src) return;
    const s = settingsStore.getState();
    if (!s.showEventLines) return src.setData(EMPTY);
    const { pin } = worldStore.getState();
    const { events } = dayDataStore.getState();
    src.setData(eventLines(pin, events, this.rayM, { showGc: s.showGc }));
  }

  private renderLive() {
    if (!this.styleReady) return;
    const src = this.map.getSource(LIVE_SRC) as GeoJSONSource | undefined;
    if (!src) return;
    const s = settingsStore.getState();
    if (!s.showLiveLines) return src.setData(EMPTY);
    const w = worldStore.getState();
    const obs = makeObserver(w.pin, w.pinHeightM);
    const date = new Date(w.time);
    const pos = { sun: position('sun', date, obs), moon: position('moon', date, obs), gc: position('gc', date, obs) };
    src.setData(liveLines(w.pin, pos, this.rayM, { showShadow: s.showShadow, showGc: s.showGc }));
  }

  private renderGeodetic() {
    if (!this.styleReady) return;
    const src = this.map.getSource(GEO_SRC) as GeoJSONSource | undefined;
    if (!src) return;
    const w = worldStore.getState();
    if (!w.pin2) return src.setData(EMPTY);
    const t = terrainStore.getState();
    const fresh = t.profile && t.profileKey === profileKeyFor(w, settingsStore.getState());
    src.setData(geodeticLine(w.pin, w.pin2, fresh ? t.profile!.los.status : 'unknown'));
  }

  dispose() {
    for (const u of this.unsubs) u();
    cancelAnimationFrame(this.dragRaf);
    cancelAnimationFrame(this.drag2Raf);
    this.pin.remove();
    this.pin2?.remove();
    this.map.remove();
  }
}
