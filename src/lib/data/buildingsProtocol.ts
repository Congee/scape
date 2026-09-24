import { addProtocol, type VectorSourceSpecification } from 'maplibre-gl';
import { BUILDINGS_ZOOM } from '@core/tiles/buildingsRegion';
import { BUILDINGS_ATTRIBUTION, buildingTileBytes } from './buildingTiles';

/** MapLibre reads building tiles through our own protocol so downloaded regions win over the network. */
const TEMPLATE = 'scape-bld://{z}/{x}/{y}';

let registered = false;

/** Registers `scape-bld://{z}/{x}/{y}` once: downloaded regions first, the live Overture archive otherwise. */
export function ensureBuildingsProtocol(): void {
  if (registered) return;
  registered = true;
  addProtocol('scape-bld', async (params, abortController) => {
    const m = /scape-bld:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    if (!m) throw new Error(`Invalid building tile URL ${params.url}`);
    const data = await buildingTileBytes(+m[1], +m[2], +m[3], abortController.signal);
    return { data: data ? new Uint8Array(data) : new Uint8Array(0) };
  });
}

/** A static TileJSON: a `pmtiles://` source would read the live archive's header first and fail offline. */
export function buildingsSource(minzoom: number): VectorSourceSpecification {
  ensureBuildingsProtocol();
  return { type: 'vector', tiles: [TEMPLATE], minzoom, maxzoom: BUILDINGS_ZOOM, attribution: BUILDINGS_ATTRIBUTION };
}
