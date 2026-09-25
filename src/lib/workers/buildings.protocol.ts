import type { LngLat } from '@core/geo/geodesy';
import type { MeshOccluderParts } from '@core/geo/meshOcclude';
import type { PrismSlots } from '@core/geo/prismOcclude';
import type { PrismTile } from '@core/geo/prismRaster';
import type { SurfaceMesh } from '@core/geo/surfaces';
import type { Lod2Source } from '@core/lod2/regions';

export const BuildingsKind = { Tiles: 'Tiles', Done: 'Done', Error: 'Error', HeightAt: 'HeightAt', Height: 'Height', Mask: 'Mask', Shade: 'Shade', Models: 'Models', RowsAt: 'RowsAt', Rows: 'Rows', SuppressedIds: 'SuppressedIds', Ids: 'Ids', GroundAt: 'GroundAt', Ground: 'Ground', Lod2: 'Lod2', Lod2Tile: 'Lod2Tile', Lod2Done: 'Lod2Done', Geoid: 'Geoid', Stop: 'Stop' } as const;
export type BuildingsKind = (typeof BuildingsKind)[keyof typeof BuildingsKind];

/** OSM Simple 3D Buildings roof families the rasteriser draws; Other renders flat at the apex. */
export const RoofShape = { Flat: 0, Skillion: 1, Pyramidal: 2, Gabled: 3, Hipped: 4, Dome: 5, Other: 6 } as const;
export type RoofShape = (typeof RoofShape)[keyof typeof RoofShape];

/** Building volumes for the wedge the viewfinder is looking into; one Tiles response per tile, then Done. */
export interface TilesRequest {
  kind: typeof BuildingsKind.Tiles;
  id: number;
  pin: LngLat;
  eyeM: number;
  azFromDeg: number;
  azSpanDeg: number;
  rangeM: number;
  /** Urls of the LoD2 tiles the caller holds; Overture rows under them give way. */
  lod2Urls: string[];
  /** Tiles the caller holds with their `sig`; one still matching is not rebuilt. */
  have: [string, string][];
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
  /** Hide the Overture rows whose centroid falls inside any of these lng/lat rings; empty hides none. */
  suppress: [lng: number, lat: number][][];
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

/** The imported geoid's key (its import time), '' for none; tiles built on another grid are dropped. No response. */
export interface GeoidSync {
  kind: typeof BuildingsKind.Geoid;
  id: number;
  key: string;
}

/** Abandons the wedge and LoD2 streams in flight, fetching nothing more for them. No response. */
export interface StopRequest {
  kind: typeof BuildingsKind.Stop;
  id: number;
}

/** Every Overture row of the building under a point, parts included, with its ground; for seeding a model. */
export interface RowsAtRequest {
  kind: typeof BuildingsKind.RowsAt;
  id: number;
  point: LngLat;
}

/** Overture feature ids the current models hide, so the map can drop the same buildings. */
export interface SuppressedIdsRequest {
  kind: typeof BuildingsKind.SuppressedIds;
  id: number;
}

/** The lowest ground under a drawn footprint, on the surface building bases use. */
export interface GroundAtRequest {
  kind: typeof BuildingsKind.GroundAt;
  id: number;
  points: LngLat[];
}

/** Official LoD2 meshes for the wedge, placed eye-relative; one Lod2Tile per new tile, then Lod2Done. */
export interface Lod2Request {
  kind: typeof BuildingsKind.Lod2;
  id: number;
  pin: LngLat;
  /** Eye altitude above sea level, the prisms' frame. */
  eyeM: number;
  azFromDeg: number;
  azSpanDeg: number;
  rangeM: number;
  /** Screen pixels per radian, for the tileset's error test. */
  pxPerRad: number;
  /** Tiles the caller already holds placed for this pin and eye; they are kept, not resent. */
  have: string[];
}

export type BuildingsRequest = TilesRequest | HeightAtRequest | MaskRequest | ModelsSync | RowsAtRequest | SuppressedIdsRequest | GroundAtRequest | Lod2Request | GeoidSync | StopRequest;

/** One LoD2 content tile placed in the viewfinder's frame. */
export interface Lod2Placed {
  url: string;
  region: Lod2Source;
  mesh: SurfaceMesh;
  /** Per-building convex hulls, lng/lat; Overture rows with a centroid inside give way. */
  hulls: [lng: number, lat: number][][];
  /** lng0, lat0, lng1, lat1. */
  bbox: [number, number, number, number];
  tris: number;
  /** Heights went through the imported GSI geoid rather than the region's constant. */
  geoid: boolean;
  /** The mesh's occlusion hierarchy, built here so the main thread never pays for it. */
  occ: MeshOccluderParts;
  /** Worker time to decode and place it, milliseconds. */
  ms: number;
}

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
  | { kind: typeof BuildingsKind.Tiles; id: number; tile: PrismPlaced }
  | { kind: typeof BuildingsKind.Done; id: number; tiles: number; missing: number }
  | { kind: typeof BuildingsKind.Height; id: number; heightM: number | null }
  | { kind: typeof BuildingsKind.Rows; id: number; batch: BuildingBatch | null }
  | { kind: typeof BuildingsKind.Ids; id: number; ids: string[] }
  | { kind: typeof BuildingsKind.Ground; id: number; groundM: number | null }
  | { kind: typeof BuildingsKind.Shade; id: number; centre: LngLat; originE: number; originN: number; nx: number; ny: number; cellM: number; mask: Uint8Array; lod2: Lod2Source[]; tallM: number; ms: number }
  | { kind: typeof BuildingsKind.Lod2Tile; id: number; tile: Lod2Placed }
  | { kind: typeof BuildingsKind.Lod2Done; id: number; urls: string[]; tris: number; missing: number; error: string | null }
  | { kind: typeof BuildingsKind.Error; id: number; error: string };

/** One Overture tile's prisms, placed and indexed in the worker. */
export interface PrismPlaced {
  tileKey: string;
  /** Pin and eye the prisms are relative to. */
  frame: string;
  /** Frame, model outlines and LoD2 cover the tile was built for. */
  sig: string;
  prism: PrismTile;
  slots: PrismSlots;
  /** The prisms as GPU surfaces, so the main thread only uploads them. */
  mesh: SurfaceMesh;
  /** Rows the models and LoD2 hid. */
  hidden: number;
}
