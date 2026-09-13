import type { LngLat } from '@core/geo/geodesy';

export const BuildingsKind = { Tiles: 'Tiles', Done: 'Done', Error: 'Error' } as const;
export type BuildingsKind = (typeof BuildingsKind)[keyof typeof BuildingsKind];

/** Building volumes for the wedge the viewfinder is looking into; one Tiles response per tile, then Done. */
export interface TilesRequest {
  kind: typeof BuildingsKind.Tiles;
  id: number;
  pin: LngLat;
  azFromDeg: number;
  azSpanDeg: number;
  rangeM: number;
}

/** One z14 tile of extruded footprints, flat typed arrays so a batch transfers without copying. */
export interface BuildingBatch {
  /** "14/x/y" */
  tileKey: string;
  count: number;
  /** Outer-ring vertex range of building i is [ringStart[i], ringStart[i + 1]); the ring is not closed. */
  ringStart: Int32Array;
  lng: Float64Array;
  lat: Float64Array;
  /** Prism top above ground, metres (OpenMapTiles `render_height`). */
  heightM: Float32Array;
  /** Prism bottom above ground, metres (`render_min_height`, 0 for most). */
  minHeightM: Float32Array;
  /** Centroid of each footprint. */
  cLng: Float64Array;
  cLat: Float64Array;
  /** DEM ground at the centroid, metres; NaN where no tile was available. */
  groundM: Float32Array;
}

export type BuildingsResponse =
  | { kind: typeof BuildingsKind.Tiles; id: number; batch: BuildingBatch }
  | { kind: typeof BuildingsKind.Done; id: number; tiles: number; missing: number }
  | { kind: typeof BuildingsKind.Error; id: number; error: string };
