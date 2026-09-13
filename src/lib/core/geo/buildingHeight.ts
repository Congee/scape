/** Building heights read off an OpenMapTiles vector basemap. Pure: no map, no DOM. */

/** The parts of a style layer this needs; MapLibre's spec type is wider. */
export interface StyleLayerLike {
  id: string;
  'source-layer'?: string;
}

/** The parts of a queried feature this needs. */
export interface BuildingFeatureLike {
  properties?: Record<string, unknown> | null;
}

const SOURCE_LAYER = 'building';

/** Ids of every layer drawn from the `building` source-layer; style variants name them differently. */
export function buildingLayerIds(layers: readonly StyleLayerLike[] | undefined): string[] {
  return (layers ?? []).filter((l) => l['source-layer'] === SOURCE_LAYER).map((l) => l.id);
}

const metres = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Tallest hit, metres; null when nothing under the point carries a usable height. */
export function heightFromFeatures(features: readonly BuildingFeatureLike[]): number | null {
  let best: number | null = null;
  for (const f of features) {
    const p = f.properties;
    if (!p) continue;
    const h = metres(p.render_height) ?? metres(p.height);
    if (h != null && (best == null || h > best)) best = h;
  }
  return best;
}
