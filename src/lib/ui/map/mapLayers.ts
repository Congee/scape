import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { shallow } from 'zustand/shallow';
import { makeObserver } from '@core/astro/bodies';
import { nightFeatures, nightModel, nightShiftPx, type NightModel } from '@core/astro/terminator';
import { settingsStore } from '@state/settings';
import { EYE_HEIGHT_M, pinSiteHeightM, terrainStore } from '@state/terrain';
import { worldStore } from '@state/world';
import { ELEVATION_COLOR, NIGHT_COLOR, nightCapAlpha, RISE_LINE_COLOR } from './layerRamps';
import { SlopeLayer, TerrainShade } from './slopeLayer';

const NIGHT_SRC = 'daynight';
const NIGHT_FILL = 'daynight-fill';
const NIGHT_LINE = 'daynight-line';
const ELEV_LAYER = 'elevation-tint';
const SLOPE_LAYER = 'slope-tint';
const ASPECT_LAYER = 'aspect-tint';
const HEAT_LAYER = 'heat';
const HILLSHADE_LAYER = 'hillshade';
// Below this the line moves too little to redraw.
const MIN_SHIFT_PX = 0.5;
const MAX_RING_ZOOM = 16;

/** Day/night shading and the DEM tints (elevation, slope, aspect), each driven by its own setting. */
export class MapLayers {
  private ready = false;
  private shown: NightModel | null = null;
  private builtZoom = -Infinity;
  private readonly slope: SlopeLayer;
  private readonly aspect: SlopeLayer;
  private readonly unsubs: (() => void)[] = [];

  constructor(
    private readonly map: MlMap,
    private readonly demSource: string,
    private readonly ensureDem: (id: string) => void
  ) {
    this.slope = new SlopeLayer(SLOPE_LAYER, demSource, TerrainShade.Slope);
    this.aspect = new SlopeLayer(ASPECT_LAYER, demSource, TerrainShade.Aspect);
    const onStyle = () => {
      this.ready = true;
      this.shown = null;
      this.applyNight();
      this.applyDem();
    };
    const onMove = () => this.refreshNight();
    map.on('style.load', onStyle);
    map.on('moveend', onMove);
    this.unsubs.push(
      () => map.off('style.load', onStyle),
      () => map.off('moveend', onMove),
      settingsStore.subscribe((s) => [s.showDayNight, s.dayNightOpacity] as const, () => this.applyNight(), { equalityFn: shallow }),
      worldStore.subscribe((w) => [w.time, w.pin, w.pinHeightM] as const, () => this.refreshNight(), { equalityFn: shallow }),
      terrainStore.subscribe((t) => t.pinGroundM, () => this.refreshNight()),
      settingsStore.subscribe(
        (s) => [s.terrain, s.terrain3d, s.showElevation, s.elevationOpacity, s.showSlope, s.slopeOpacity, s.showAspect, s.aspectOpacity] as const,
        () => this.applyDem(),
        { equalityFn: shallow }
      )
    );
  }

  private anchor(): string | undefined {
    if (this.map.getLayer(HEAT_LAYER)) return HEAT_LAYER;
    return this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id ?? (this.map.getLayer('fov-fill') ? 'fov-fill' : undefined);
  }

  private applyNight() {
    if (!this.ready) return;
    const s = settingsStore.getState();
    const m = this.map;
    if (!s.showDayNight) {
      for (const id of [NIGHT_LINE, NIGHT_FILL]) if (m.getLayer(id)) m.removeLayer(id);
      if (m.getSource(NIGHT_SRC)) m.removeSource(NIGHT_SRC);
      this.shown = null;
      return;
    }
    if (!m.getSource(NIGHT_SRC)) {
      m.addSource(NIGHT_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      const before = this.anchor();
      m.addLayer({ id: NIGHT_FILL, type: 'fill', source: NIGHT_SRC, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': NIGHT_COLOR, 'fill-antialias': false } }, before);
      m.addLayer({ id: NIGHT_LINE, type: 'line', source: NIGHT_SRC, filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': RISE_LINE_COLOR, 'line-width': 1.5 } }, before);
    }
    m.setPaintProperty(NIGHT_FILL, 'fill-opacity', nightCapAlpha(s.dayNightOpacity));
    m.setPaintProperty(NIGHT_LINE, 'line-opacity', Math.min(1, s.dayNightOpacity + 0.3));
    this.refreshNight();
  }

  /** Rebuilds the caps only when the line would visibly move or the view outgrows their detail. */
  private refreshNight() {
    const src = this.ready ? (this.map.getSource(NIGHT_SRC) as GeoJSONSource | undefined) : undefined;
    if (!src) return;
    const w = worldStore.getState();
    const model = nightModel(new Date(w.time), makeObserver(w.pin, pinSiteHeightM(w, terrainStore.getState())), w.pinHeightM + EYE_HEIGHT_M);
    const zoom = this.map.getZoom();
    if (this.shown && zoom <= this.builtZoom && nightShiftPx(this.shown, model, 512 * 2 ** zoom) < MIN_SHIFT_PX) return;
    this.builtZoom = Math.min(Math.ceil(zoom) + 1, MAX_RING_ZOOM);
    this.shown = model;
    src.setData(nightFeatures(model, 0.25 / (512 * 2 ** this.builtZoom)));
  }

  /** Elevation tint also keeps the DEM textures uploaded for the slope and aspect shaders, so it stays (clear) while either is on. */
  private applyDem() {
    if (!this.ready) return;
    const s = settingsStore.getState();
    const m = this.map;
    const shades = [
      [this.slope, s.showSlope, s.slopeOpacity],
      [this.aspect, s.showAspect, s.aspectOpacity]
    ] as const;
    // Custom layers are not draped on 3D terrain.
    const want = shades.map(([, on]) => s.terrain && !s.terrain3d && on);
    const elev = s.terrain && s.showElevation;
    const keep = elev || want.some(Boolean);
    if (!keep) {
      for (const id of [ASPECT_LAYER, SLOPE_LAYER, ELEV_LAYER]) if (m.getLayer(id)) m.removeLayer(id);
      return;
    }
    const before = () => (m.getLayer(HILLSHADE_LAYER) ? HILLSHADE_LAYER : this.anchor());
    if (!m.getLayer(ELEV_LAYER)) {
      this.ensureDem(this.demSource);
      m.addLayer({ id: ELEV_LAYER, type: 'color-relief', source: this.demSource, paint: { 'color-relief-color': ELEVATION_COLOR } }, before());
    }
    m.setPaintProperty(ELEV_LAYER, 'color-relief-opacity', elev ? s.elevationOpacity : 0);
    shades.forEach(([layer, , opacity], i) => {
      layer.opacity = opacity;
      if (want[i] && !m.getLayer(layer.id)) m.addLayer(layer, before());
      else if (!want[i] && m.getLayer(layer.id)) m.removeLayer(layer.id);
    });
    m.triggerRepaint();
  }

  dispose() {
    for (const u of this.unsubs) u();
  }
}
