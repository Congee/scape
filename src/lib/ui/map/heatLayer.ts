import { Marker, type ImageSource, type Map as MaplibreMap } from 'maplibre-gl';
import { shallow } from 'zustand/shallow';
import { gridCorners } from '@core/geo/grid';
import { alignStore } from '@state/align';
import type { AlignCandidate } from '@workers/align.protocol';
import { paintHeat } from './heat';
import { BLANK_PNG } from './mapShared';

const HEAT_SRC = 'heat';
export const HEAT_LAYER = 'heat';

/** The alignment finder's heat grid and its candidate marker. */
export class HeatLayer {
  private candidate: Marker | null = null;
  private readonly unsubs: (() => void)[];

  constructor(
    private readonly map: MaplibreMap,
    private readonly styleReady: () => boolean
  ) {
    this.unsubs = [
      alignStore.subscribe((st) => [st.result, st.opacity] as const, () => this.render(), { equalityFn: shallow }),
      alignStore.subscribe((st) => st.candidate, (c) => this.syncCandidate(c))
    ];
  }

  addLayer(beforeId: string | undefined) {
    this.map.addSource(HEAT_SRC, { type: 'image', url: BLANK_PNG, coordinates: [[-1, 1], [1, 1], [1, -1], [-1, -1]] });
    this.map.addLayer(
      {
        id: HEAT_LAYER,
        type: 'raster',
        source: HEAT_SRC,
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': alignStore.getState().opacity, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 }
      },
      beforeId
    );
  }

  render() {
    const src = this.styleReady() ? (this.map.getSource(HEAT_SRC) as ImageSource | undefined) : undefined;
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

  dispose() {
    for (const u of this.unsubs) u();
    this.candidate?.remove();
  }
}
