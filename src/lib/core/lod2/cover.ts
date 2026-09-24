/** Which LoD2 tiles reach an Overture tile, so only the tiles they touch are rebuilt. */

import type { SuppressRing } from '@core/geo/buildingTiles';
import { tilePixelToLngLat } from '@core/terrain/tiles';

export interface Lod2Cover {
  url: string;
  /** lng0, lat0, lng1, lat1. */
  bbox: readonly [number, number, number, number];
  rings: readonly SuppressRing[];
}

/** Overture rows may straddle their tile's edge, so the test reaches this share of a tile past it. */
const EDGE_PAD = 0.25;

/** The LoD2 rings over the "z/x/y" tile, and a signature that changes only when those tiles do. */
export function lod2CoverOf(key: string, covers: Iterable<Lod2Cover>): { sig: string; rings: SuppressRing[] } {
  const [z, x, y] = key.split('/').map(Number);
  const nw = tilePixelToLngLat(z, x, y, -EDGE_PAD, -EDGE_PAD, 1);
  const se = tilePixelToLngLat(z, x, y, 1 + EDGE_PAD, 1 + EDGE_PAD, 1);
  const urls: string[] = [];
  const rings: SuppressRing[] = [];
  for (const c of covers) {
    if (c.bbox[2] < nw.lng || c.bbox[0] > se.lng || c.bbox[3] < se.lat || c.bbox[1] > nw.lat) continue;
    urls.push(c.url);
    rings.push(...c.rings);
  }
  return { sig: urls.toSorted().join('|'), rings };
}
