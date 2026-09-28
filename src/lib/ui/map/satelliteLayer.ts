import type { IControl, Map as MlMap } from 'maplibre-gl';
import { creditsFor } from '@core/tiles/satellite';
import { satelliteSource, satKeys } from '@data/satellite';
import { settingsStore } from '@state/settings';

const SAT_SRC = 'satellite';
const SAT_CREDIT_SRC = 'satellite-credit';

/** MapTiler's free plan requires its logo on the map. */
class MapTilerLogo implements IControl {
  private el: HTMLElement | null = null;

  onAdd(): HTMLElement {
    const a = document.createElement('a');
    a.className = 'maplibregl-ctrl maptiler-logo';
    a.href = 'https://www.maptiler.com/';
    a.target = '_blank';
    a.rel = 'noopener';
    a.dataset.satLogo = 'maptiler';
    const img = document.createElement('img');
    img.src = 'https://api.maptiler.com/resources/logo.svg';
    img.alt = 'MapTiler logo';
    img.height = 20;
    a.append(img);
    this.el = a;
    return a;
  }

  onRemove(): void {
    this.el?.remove();
    this.el = null;
  }
}

/** Satellite imagery under the basemap's labels, with credits for the sources in view. Adds nothing while off. */
export class SatelliteLayer {
  private ready = false;
  private logo: MapTilerLogo | null = null;
  private readonly keys = satKeys();
  private readonly unsubs: (() => void)[] = [];

  constructor(private readonly map: MlMap) {
    const onStyle = () => {
      this.ready = true;
      this.apply();
    };
    const onMove = () => this.credit();
    map.on('style.load', onStyle);
    map.on('moveend', onMove);
    this.unsubs.push(
      () => map.off('style.load', onStyle),
      () => map.off('moveend', onMove),
      settingsStore.subscribe((s) => s.showSatellite, () => this.apply())
    );
  }

  /** Above the basemap's fills and lines, below its labels and every overlay. */
  private anchor(): string | undefined {
    const m = this.map;
    // The first sourced layer and the vector layers are the basemap (Liberty opens with a natural_earth raster).
    let basemap = false;
    for (const l of m.getStyle().layers) {
      if (l.id === SAT_SRC || !('source' in l)) continue;
      const vector = m.getSource(l.source)?.type === 'vector';
      if (l.type === 'symbol' || (basemap && !vector)) return l.id;
      basemap = true;
    }
    return undefined;
  }

  private apply() {
    if (!this.ready) return;
    const on = settingsStore.getState().showSatellite;
    const m = this.map;
    if (on && !m.getLayer(SAT_SRC)) {
      if (!m.getSource(SAT_SRC)) m.addSource(SAT_SRC, satelliteSource());
      m.addLayer({ id: SAT_SRC, type: 'raster', source: SAT_SRC, paint: { 'raster-fade-duration': 0 } }, this.anchor());
    } else if (!on && m.getLayer(SAT_SRC)) {
      m.removeLayer(SAT_SRC);
      m.removeSource(SAT_SRC);
    }
    const wantLogo = on && !!this.keys.maptiler;
    if (wantLogo && !this.logo) m.addControl((this.logo = new MapTilerLogo()), 'bottom-left');
    else if (!wantLogo && this.logo) {
      m.removeControl(this.logo);
      this.logo = null;
    }
    this.credit();
  }

  private credit() {
    if (!this.ready) return;
    const m = this.map;
    const on = settingsStore.getState().showSatellite;
    const b = m.getBounds();
    const view = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    const text = on ? creditsFor(view, m.getZoom(), { keys: this.keys, online: navigator.onLine }).join(' · ') : '';
    const src = m.getSource(SAT_CREDIT_SRC);
    if ((src?.attribution ?? '') === text) return;
    if (src) {
      m.removeLayer(SAT_CREDIT_SRC);
      m.removeSource(SAT_CREDIT_SRC);
    }
    if (!text) return;
    m.addSource(SAT_CREDIT_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: text });
    m.addLayer({ id: SAT_CREDIT_SRC, type: 'fill', source: SAT_CREDIT_SRC, paint: { 'fill-opacity': 0 } });
  }

  dispose() {
    for (const u of this.unsubs) u();
    if (this.logo) this.map.removeControl(this.logo);
  }
}
