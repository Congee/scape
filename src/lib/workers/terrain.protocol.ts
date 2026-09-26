import type { LngLat } from '@core/geo/geodesy';
import type { HorizonProfile } from '@core/terrain/horizon';
import type { LosResult } from '@core/terrain/los';
import type { MeshLevel, MeshView } from '@core/terrain/mesh';
import type { ViewProfile } from '@core/terrain/view';

export const TerrainKind = { Elevation: 'Elevation', Profile: 'Profile', Horizon: 'Horizon', View: 'View', Points: 'Points', Mesh: 'Mesh' } as const;
export type TerrainKind = (typeof TerrainKind)[keyof typeof TerrainKind];

export interface ElevationRequest {
  kind: typeof TerrainKind.Elevation;
  id: number;
  points: LngLat[];
}

/** Ground under arbitrary points (markers); same work as Elevation, separate queue. */
export interface PointsRequest {
  kind: typeof TerrainKind.Points;
  id: number;
  points: LngLat[];
}

export interface ProfileRequest {
  kind: typeof TerrainKind.Profile;
  id: number;
  a: LngLat;
  b: LngLat;
  eyeAboveGroundM: number;
  targetAboveGroundM: number;
  samples: number;
}

export interface HorizonRequest {
  kind: typeof TerrainKind.Horizon;
  id: number;
  pin: LngLat;
  eyeAboveGroundM: number;
  rangeM: number;
  azStepDeg: number;
}

/** Layered terrain view over an azimuth window, for the viewfinder. */
export interface ViewRequest {
  kind: typeof TerrainKind.View;
  id: number;
  pin: LngLat;
  eyeAboveGroundM: number;
  azFromDeg: number;
  azSpanDeg: number;
  azStepDeg: number;
  rangeM: number;
  /** Smallest angle step worth recording between visible points. */
  minStepDeg: number;
}

/** Terrain heightfield geometry for the GPU: a quadtree around the pin, one response per level. */
export interface MeshRequest {
  kind: typeof TerrainKind.Mesh;
  id: number;
  pin: LngLat;
  eyeAboveGroundM: number;
  rangeM: number;
  /** What the frame is looking at, which decides how finely the ground inside it is cut. */
  view: MeshView | null;
}

export type TerrainRequest = ElevationRequest | PointsRequest | ProfileRequest | HorizonRequest | ViewRequest | MeshRequest;

export const RECYCLE = 'Recycle';
/** Buffers of mesh levels the main thread is done with, transferred back for the next rebuild. */
export interface RecycleMessage {
  kind: typeof RECYCLE;
  buffers: ArrayBuffer[];
}

export type TerrainMessage = TerrainRequest | RecycleMessage;

export interface ProfileResult {
  a: LngLat;
  b: LngLat;
  totalM: number;
  bearingDeg: number;
  backBearingDeg: number;
  zoom: number;
  distM: Float32Array;
  /** Raw DEM ground along the path, metres; NaN where no tile was available. */
  groundM: Float32Array;
  lng: Float32Array;
  lat: Float32Array;
  groundA: number;
  groundB: number;
  /** Absolute eye and target heights used for the sightline. */
  eyeM: number;
  targetM: number;
  los: LosResult;
  missing: number;
}

export interface HorizonResult {
  profile: HorizonProfile;
  groundM: number;
  eyeM: number;
  tiles: number;
  missing: number;
  /** False for the coarse skyline posted while the refinement's tiles load. */
  refined: boolean;
}

export interface ViewResult {
  profile: ViewProfile;
  groundM: number;
  eyeM: number;
  tiles: number;
  missing: number;
  /** False for the coarse view posted while the refinement's tiles load. */
  refined: boolean;
}

export interface MeshResult {
  mesh: MeshLevel;
  /** DEM zoom this level's heights came from. */
  zoom: number;
  eyeM: number;
  groundM: number;
  /** Levels this build will send in all; the finest arrives first. */
  levels: number;
  tiles: number;
  /** Blocks of this level taken from the worker's cache rather than sampled again. */
  reused: number;
  cacheBytes: number;
  /** How far out the frame's own resolution was afforded, and the cell angle it holds there. */
  reachM: number;
  targetRad: number;
  /** Cell of the finest level the budget afforded. */
  minCellM: number;
  ms: number;
}

export type TerrainResponse =
  | { kind: typeof TerrainKind.Elevation; id: number; elevations: number[] }
  | { kind: typeof TerrainKind.Points; id: number; elevations: number[] }
  | { kind: typeof TerrainKind.Profile; id: number; result: ProfileResult }
  | { kind: typeof TerrainKind.Horizon; id: number; result: HorizonResult }
  | { kind: typeof TerrainKind.View; id: number; result: ViewResult }
  | { kind: typeof TerrainKind.Mesh; id: number; result: MeshResult }
  | { kind: 'Error'; id: number; of: TerrainKind; error: string };
