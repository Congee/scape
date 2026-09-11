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
import { dayDataStore } from '@state/dayData';
import { mapStatusStore } from '@state/mapStatus';
import { findBasemap, settingsStore } from '@state/settings';
import { worldStore } from '@state/world';
import { eventLines, liveLines } from './overlays';

const EVENTS_SRC = 'sky-events';
const LIVE_SRC = 'sky-live';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Owns the MapLibre instance and keeps its overlays in sync with the stores. No React inside. */
export class MapController {
  private map: MaplibreMap;
  private pin: Marker;
  private scale: ScaleControl;
  private unsubs: (() => void)[] = [];
  private rayM = 50_000;
  private styleReady = false;
  private basemapId = '';
  private dragging = false;
  private dragRaf = 0;

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

    this.pin = new Marker({ draggable: true, color: '#e5322d' }).setLngLat([w.pin.lng, w.pin.lat]).addTo(this.map);
    this.pin.on('dragstart', () => (this.dragging = true));
    this.pin.on('drag', () => {
      if (this.dragRaf) return;
      this.dragRaf = requestAnimationFrame(() => {
        this.dragRaf = 0;
        const ll = this.pin.getLngLat();
        worldStore.getState().setPin({ lng: ll.lng, lat: ll.lat });
      });
    });
    this.pin.on('dragend', () => {
      this.dragging = false;
      const ll = this.pin.getLngLat();
      worldStore.getState().setPin({ lng: ll.lng, lat: ll.lat });
    });

    this.map.on('click', (e: MapMouseEvent) => {
      if (settingsStore.getState().clickMovesPin) worldStore.getState().setPin({ lng: e.lngLat.lng, lat: e.lngLat.lat });
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
        },
        { equalityFn: (a, b) => a.lat === b.lat && a.lng === b.lng }
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
      settingsStore.subscribe((st) => st.units, (u) => this.scale.setUnit(u))
    );
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
    this.map.addLayer({
      id: 'sky-events-line',
      type: 'line',
      source: EVENTS_SRC,
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.9 }
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

  dispose() {
    for (const u of this.unsubs) u();
    cancelAnimationFrame(this.dragRaf);
    this.pin.remove();
    this.map.remove();
  }
}
