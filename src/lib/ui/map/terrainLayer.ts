import type { Map as MaplibreMap } from 'maplibre-gl';
import { shallow } from 'zustand/shallow';
import { demSourceSpec } from '@data/demSource';
import { DEM_TILE_TEMPLATE, TERRAIN_ATTRIBUTION, TERRAIN_MAX_ZOOM, TERRAIN_TILE_SIZE } from '@data/terrainTiles';
import { settingsStore } from '@state/settings';
import { HEAT_LAYER } from './heatLayer';

// MapLibre wants separate DEM sources for hillshade and 3D terrain; same tiles, cached once by the browser.
const DEM_SRC = 'terrain-dem';
export const HILL_SRC = 'terrain-dem-hillshade';

export function ensureDem(map: MaplibreMap, id: string) {
  if (map.getSource(id)) return;
  map.addSource(
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

/** Hillshade and 3D terrain from the DEM, each behind its setting. */
export class TerrainLayer {
  private readonly unsubs: (() => void)[];

  constructor(
    private readonly map: MaplibreMap,
    private readonly styleReady: () => boolean
  ) {
    this.unsubs = [
      settingsStore.subscribe(
        (st) => [st.terrain, st.showHillshade, st.terrain3d] as const,
        () => this.apply(),
        { equalityFn: shallow }
      )
    ];
  }

  /** Hillshade sits under labels and our lines. */
  apply() {
    if (!this.styleReady()) return;
    const s = settingsStore.getState();
    const hill = s.terrain && s.showHillshade;
    const t3d = s.terrain && s.terrain3d;
    if (hill && !this.map.getLayer('hillshade')) {
      ensureDem(this.map, HILL_SRC);
      const before = this.map.getLayer(HEAT_LAYER) ? HEAT_LAYER : (this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id ?? 'fov-fill');
      this.map.addLayer(
        { id: 'hillshade', type: 'hillshade', source: HILL_SRC, paint: { 'hillshade-method': 'igor', 'hillshade-exaggeration': 0.6 } },
        before
      );
    } else if (!hill && this.map.getLayer('hillshade')) {
      this.map.removeLayer('hillshade');
    }
    if (t3d) ensureDem(this.map, DEM_SRC);
    this.map.setTerrain(t3d ? { source: DEM_SRC, exaggeration: 1 } : null);
  }

  dispose() {
    for (const u of this.unsubs) u();
  }
}
