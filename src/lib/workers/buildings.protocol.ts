import type { LngLat } from '@core/geo/geodesy';

export const BuildingsKind = { Tiles: 'Tiles', Done: 'Done', Error: 'Error', HeightAt: 'HeightAt', Height: 'Height', Mask: 'Mask', Shade: 'Shade', Models: 'Models', RowsAt: 'RowsAt', Rows: 'Rows' } as const;
export type BuildingsKind = (typeof BuildingsKind)[keyof typeof BuildingsKind];

/** OSM Simple 3D Buildings roof families the rasteriser draws; Other renders flat at the apex. */
export const RoofShape = { Flat: 0, Skillion: 1, Pyramidal: 2, Gabled: 3, Hipped: 4, Dome: 5, Other: 6 } as const;
export type RoofShape = (typeof RoofShape)[keyof typeof RoofShape];

/** Building volumes for the wedge the viewfinder is looking into; one Tiles response per tile, then Done. */
export interface TilesRequest {
  kind: typeof BuildingsKind.Tiles;
  id: number;
  pin: LngLat;
  azFromDeg: number;
  azSpanDeg: number;
  rangeM: number;
}

/** Apex height of the building under a point (max over the building and all its parts); null when none. */
export interface HeightAtRequest {
  kind: typeof BuildingsKind.HeightAt;
  id: number;
  point: LngLat;
}

/** Ground-shadow mask for the map viewport; the caller sizes the grid, the worker fills it. */
export interface MaskRequest {
  kind: typeof BuildingsKind.Mask;
  id: number;
  centre: LngLat;
  /** Metres east/north of `centre` to the grid's first cell, in the centre's local Mercator frame. */
  originE: number;
  originN: number;
  nx: number;
  ny: number;
  cellM: number;
  sunAzDeg: number;
  sunAltDeg: number;
  /** Stamp roofs into the grid; off below the buildings' minzoom, where the rect is far wider than they resolve. */
  buildings: boolean;
  /** Shadow ramps from lit to full over this depth below the ceiling, metres. */
  softM: number;
}

/** A precise model as the workers see it: what it hides and the surface it stamps into the mask. */
export interface WorkerModel {
  id: string;
  footprint: [lng: number, lat: number][];
  /** Hide the Overture rows whose centroid falls inside `footprint`. */
  suppress: boolean;
  /** lng, lat, sea-level altitude per vertex, three vertices per triangle; empty for a hidden model. */
  tris: Float64Array;
}

/** Replaces the worker's models; no response. */
export interface ModelsSync {
  kind: typeof BuildingsKind.Models;
  id: number;
  rev: number;
  models: WorkerModel[];
}

/** Every Overture row of the building under a point, parts included, with its ground; for seeding a model. */
export interface RowsAtRequest {
  kind: typeof BuildingsKind.RowsAt;
  id: number;
  point: LngLat;
}

export type BuildingsRequest = TilesRequest | HeightAtRequest | MaskRequest | ModelsSync | RowsAtRequest;

/** Worker name the map's mask instance runs under; it sizes its caches for the map rect. */
export const MASK_WORKER_NAME = 'buildings-mask';

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

export type BuildingsResponse =
  | { kind: typeof BuildingsKind.Tiles; id: number; batch: BuildingBatch }
  | { kind: typeof BuildingsKind.Done; id: number; tiles: number; missing: number }
  | { kind: typeof BuildingsKind.Height; id: number; heightM: number | null }
  | { kind: typeof BuildingsKind.Rows; id: number; batch: BuildingBatch | null }
  | { kind: typeof BuildingsKind.Shade; id: number; centre: LngLat; originE: number; originN: number; nx: number; ny: number; cellM: number; mask: Uint8Array; ms: number }
  | { kind: typeof BuildingsKind.Error; id: number; error: string };
