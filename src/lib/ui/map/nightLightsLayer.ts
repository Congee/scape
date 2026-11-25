import type { Map as MaplibreMap } from 'maplibre-gl';
import { settingsStore } from '@state/settings';

// NASA GIBS, public domain; a coarse (zoom ≤ 8) proxy for light pollution.
const LIGHTS_SRC = 'night-lights';
const LIGHTS_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png';
const LIGHTS_ATTRIBUTION = 'Night lights: <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a>, VIIRS Black Marble 2016';

/** Light pollution as satellite night lights, under the labels. */
export class NightLightsLayer {
  private readonly unsubs: (() => void)[];

  constructor(
    private readonly map: MaplibreMap,
    private readonly styleReady: () => boolean
  ) {
    this.unsubs = [settingsStore.subscribe((st) => st.showLightPollution, () => this.apply())];
  }

  apply() {
    if (!this.styleReady()) return;
    const on = settingsStore.getState().showLightPollution;
    if (on && !this.map.getLayer(LIGHTS_SRC)) {
      if (!this.map.getSource(LIGHTS_SRC)) this.map.addSource(LIGHTS_SRC, { type: 'raster', tiles: [LIGHTS_URL], tileSize: 256, maxzoom: 8, attribution: LIGHTS_ATTRIBUTION });
      const before = this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id ?? 'fov-fill';
      this.map.addLayer({ id: LIGHTS_SRC, type: 'raster', source: LIGHTS_SRC, paint: { 'raster-opacity': 0.75 } }, before);
    } else if (!on && this.map.getLayer(LIGHTS_SRC)) {
      this.map.removeLayer(LIGHTS_SRC);
    }
  }

  dispose() {
    for (const u of this.unsubs) u();
  }
}
