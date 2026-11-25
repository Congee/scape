import type { Map as MaplibreMap } from 'maplibre-gl';
import { buildingLayerIds } from '@core/geo/buildingHeight';
import { isDarkBasemap } from '@data/basemaps';
import { buildingsSource } from '@data/buildingsProtocol';
import { suppressedBuildingIds } from '@state/buildings';
import { modelsStore } from '@state/models';
import { currentBasemap } from '@state/offline';
import { settingsStore } from '@state/settings';
import { buildingFilter, buildingPaint } from './buildingStyle';
import { latestOnly } from './latest';

// Scape's own Overture buildings, replacing whatever the basemap draws.
const BLD_SRC = 'overture-buildings';
export const BLD_LAYER = 'overture-building';
export const BLD_PART_LAYER = 'overture-building-part';
export const BLD_MIN_ZOOM = 14;

/** Our extrusions sit under the labels, over the shadow mask, and in place of the basemap's buildings. */
export class BuildingsLayer {
  /** Overture feature ids a visible model stands in for. */
  private hiddenIds: string[] = [];
  /** A later model change's answer may land first; only the newest applies. */
  private askSuppressed = latestOnly(suppressedBuildingIds);
  private readonly unsubs: (() => void)[];

  constructor(
    private readonly map: MaplibreMap,
    private readonly styleReady: () => boolean,
    private readonly changed: () => void
  ) {
    this.unsubs = [
      modelsStore.subscribe((st) => st.rev, () => void this.refreshSuppression()),
      settingsStore.subscribe((st) => st.showBuildings, () => this.apply())
    ];
  }

  apply() {
    if (!this.styleReady()) return;
    const on = settingsStore.getState().showBuildings;
    if (on && !this.map.getLayer(BLD_LAYER)) {
      if (!this.map.getSource(BLD_SRC)) this.map.addSource(BLD_SRC, buildingsSource(BLD_MIN_ZOOM));
      const before = this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
      const paint = buildingPaint(isDarkBasemap(currentBasemap()));
      this.map.addLayer(
        {
          id: BLD_LAYER,
          type: 'fill-extrusion',
          source: BLD_SRC,
          'source-layer': 'building',
          minzoom: BLD_MIN_ZOOM,
          // Overture replaces a building that has parts with those parts; drawing both double-draws it.
          filter: buildingFilter(true, this.hiddenIds),
          paint
        },
        before
      );
      this.map.addLayer(
        { id: BLD_PART_LAYER, type: 'fill-extrusion', source: BLD_SRC, 'source-layer': 'building_part', minzoom: BLD_MIN_ZOOM, filter: buildingFilter(false, this.hiddenIds), paint },
        before
      );
    } else if (!on) {
      for (const id of [BLD_LAYER, BLD_PART_LAYER]) if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    this.setBasemapBuildings(!on);
    this.changed();
  }

  /** The worker knows which Overture rows the models suppress; the map hides the same ones. */
  private async refreshSuppression() {
    const answer = await this.askSuppressed();
    if (answer === undefined) return;
    const ids = answer ?? this.hiddenIds;
    if (ids.length === this.hiddenIds.length && ids.every((id, i) => id === this.hiddenIds[i])) return;
    this.hiddenIds = ids;
    if (!this.styleReady()) return;
    for (const id of [BLD_LAYER, BLD_PART_LAYER]) if (this.map.getLayer(id)) this.map.setFilter(id, buildingFilter(id === BLD_LAYER, this.hiddenIds));
  }

  /** The basemap's own extrusions are hidden, not removed: the target's height still queries them. */
  private setBasemapBuildings(visible: boolean) {
    for (const id of buildingLayerIds(this.map.getStyle()?.layers)) {
      if (id === BLD_LAYER || id === BLD_PART_LAYER || !this.map.getLayer(id)) continue;
      this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  }

  dispose() {
    for (const u of this.unsubs) u();
  }
}
