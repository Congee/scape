/** OSM Simple 3D Buildings roof families the rasteriser draws; Other renders flat at the apex. */
export const RoofShape = { Flat: 0, Skillion: 1, Pyramidal: 2, Gabled: 3, Hipped: 4, Dome: 5, Other: 6 } as const;
export type RoofShape = (typeof RoofShape)[keyof typeof RoofShape];

/**
 * One z14 tile of extruded footprints, flat typed arrays so a batch transfers without copying.
 * A row is either a whole building or one `building_part`; parents with parts are not emitted.
 */
export interface BuildingBatch {
  /** "14/x/y" */
  tileKey: string;
  count: number;
  /** Outer-ring vertex range of row i is [ringStart[i], ringStart[i + 1]); the ring is not closed. */
  ringStart: Int32Array;
  lng: Float64Array;
  lat: Float64Array;
  /** Apex above ground, metres (`height`, or floors × 3 m, or a class default). Roof base = heightM − roofHeightM. */
  heightM: Float32Array;
  /** Bottom above ground, metres (`min_height`, 0 for most rows). */
  minHeightM: Float32Array;
  /** RoofShape code per row. */
  roofShape: Uint8Array;
  /** Vertical extent of the roof, metres; 0 = unknown, the rasteriser picks a default for non-flat shapes. */
  roofHeightM: Float32Array;
  /** OSM `roof:direction`, compass degrees; skillion slopes down toward it, a ridge runs perpendicular to it. NaN when absent. */
  roofDirDeg: Float32Array;
  /** 1 when `roof:orientation=across` (ridge across the footprint's long side), else 0. */
  roofAcross: Uint8Array;
  /** Centroid of each footprint. */
  cLng: Float64Array;
  cLat: Float64Array;
  /** Ground for the row's building, metres: min DEM over its footprint(s); NaN where no DEM tile was available. */
  groundM: Float32Array;
}
