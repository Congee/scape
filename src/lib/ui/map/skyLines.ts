import type { GeoJSONSource, Map as MaplibreMap } from 'maplibre-gl';
import { shallow } from 'zustand/shallow';
import { makeObserver, SkyBody } from '@core/astro/bodies';
import { lunarShadowCoverage } from '@core/astro/eclipse';
import { position } from '@core/astro/positions';
import { airDensity } from '@core/astro/refraction';
import { linesShiftPx } from '@core/drift';
import { distanceM, type LngLat } from '@core/geo/geodesy';
import { dayDataStore } from '@state/dayData';
import { settingsStore } from '@state/settings';
import { pinSiteHeightM, profileKeyFor, terrainStore } from '@state/terrain';
import { worldStore } from '@state/world';
import { HALO } from '../inks';
import { EMPTY, samePoint } from './mapShared';
import { eventLines, geodeticLine, LiveLineKind, liveLines } from './overlays';

const EVENTS_SRC = 'sky-events';
const LIVE_SRC = 'sky-live';
const GEO_SRC = 'geodetic';

/** The day's sun and moon event rays, the live rays, and the geodesic from camera to target. */
export class SkyLines {
  private rayM = 50_000;
  private live: { src: GeoJSONSource; data: GeoJSON.FeatureCollection } | null = null;
  private readonly unsubs: (() => void)[];

  constructor(
    private readonly map: MaplibreMap,
    private readonly styleReady: () => boolean
  ) {
    const both = () => {
      this.renderLive();
      this.renderGeodetic();
    };
    this.unsubs = [
      worldStore.subscribe((st) => st.pin, both, { equalityFn: samePoint }),
      worldStore.subscribe((st) => st.pin2, both, { equalityFn: samePoint }),
      worldStore.subscribe((st) => st.time, () => this.renderLive(true)),
      worldStore.subscribe((st) => st.pinHeightM, () => this.renderLive()),
      worldStore.subscribe((st) => st.pin2HeightM, () => this.renderLive()),
      dayDataStore.subscribe(() => this.renderEvents()),
      terrainStore.subscribe((st) => st.profile, () => this.renderGeodetic()),
      settingsStore.subscribe(
        (st) => [st.showEventLines, st.showLiveLines, st.showShadow, st.showGc, st.shadowObjectHeightM] as const,
        () => this.render(),
        { equalityFn: shallow }
      )
    ];
  }

  addLayers() {
    this.map.addSource(EVENTS_SRC, { type: 'geojson', data: EMPTY });
    this.map.addSource(LIVE_SRC, { type: 'geojson', data: EMPTY });
    this.map.addSource(GEO_SRC, { type: 'geojson', data: EMPTY });
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
  }

  /** Lines run far past the viewport so they reach the map edge at any zoom. */
  updateRay() {
    const b = this.map.getBounds();
    const c = this.map.getCenter();
    const corner: LngLat = { lng: b.getEast(), lat: b.getNorth() };
    this.rayM = Math.min(15_000_000, Math.max(2_000, distanceM({ lng: c.lng, lat: c.lat }, corner) * 3));
  }

  render() {
    this.renderEvents();
    this.renderLive();
    this.renderGeodetic();
  }

  private source(id: string): GeoJSONSource | undefined {
    return this.styleReady() ? (this.map.getSource(id) as GeoJSONSource | undefined) : undefined;
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

  dispose() {
    for (const u of this.unsubs) u();
  }
}
