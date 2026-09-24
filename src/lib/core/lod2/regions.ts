/** Official LoD2 building sets published as public 3D Tiles (CORS open, no key). */

import type { LngLat } from '@core/geo/geodesy';

export const Lod2Source = { Bag3d: 'Bag3d' } as const;
export type Lod2Source = (typeof Lod2Source)[keyof typeof Lod2Source];

export interface Lod2Region {
  id: Lod2Source;
  name: string;
  /** Root tileset.json. */
  tileset: string;
  /** Coverage, lng0, lat0, lng1, lat1. */
  bbox: readonly [number, number, number, number];
  licence: string;
  /** Shown whenever this region's tiles are drawn. */
  attribution: string;
  attributionUrl: string;
  /** Content heights minus sea level, when no per-building ground says otherwise. */
  geoidM: number;
  /** Per-building ground height above sea level, in the tile's property table. */
  groundProperty?: string;
  /** Stable building id in the property table. */
  idProperty?: string;
}

export const LOD2_REGIONS: readonly Lod2Region[] = [
  {
    id: Lod2Source.Bag3d,
    name: '3DBAG (Netherlands)',
    tileset: 'https://data.3dbag.nl/v20250903/cesium3dtiles/lod22/tileset.json',
    bbox: [3.2, 50.7, 7.3, 53.6],
    licence: 'CC BY 4.0',
    attribution: '© 3DBAG by tudelft3d and 3DGI, CC BY 4.0',
    attributionUrl: 'https://3dbag.nl',
    geoidM: 43.6,
    groundProperty: 'b3_h_maaiveld',
    idProperty: 'identificatie'
  }
];

/** The regions whose coverage reaches within `rangeM` of `p`. */
export function lod2RegionsNear(p: LngLat, rangeM: number): Lod2Region[] {
  const dLat = rangeM / 111_195;
  const dLng = dLat / Math.max(0.01, Math.cos((p.lat * Math.PI) / 180));
  return LOD2_REGIONS.filter((r) => p.lng + dLng >= r.bbox[0] && p.lng - dLng <= r.bbox[2] && p.lat + dLat >= r.bbox[1] && p.lat - dLat <= r.bbox[3]);
}
