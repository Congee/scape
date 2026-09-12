import type { LngLat } from '@core/geo/geodesy';
import type { HorizonProfile } from '@core/terrain/horizon';
import type { LosResult } from '@core/terrain/los';
import type { ViewProfile } from '@core/terrain/view';

export const TerrainKind = { Elevation: 'Elevation', Profile: 'Profile', Horizon: 'Horizon', View: 'View', Points: 'Points' } as const;
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

export type TerrainRequest = ElevationRequest | PointsRequest | ProfileRequest | HorizonRequest | ViewRequest;

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
}

export interface ViewResult {
  profile: ViewProfile;
  groundM: number;
  eyeM: number;
  tiles: number;
  missing: number;
}

export type TerrainResponse =
  | { kind: typeof TerrainKind.Elevation; id: number; elevations: number[] }
  | { kind: typeof TerrainKind.Points; id: number; elevations: number[] }
  | { kind: typeof TerrainKind.Profile; id: number; result: ProfileResult }
  | { kind: typeof TerrainKind.Horizon; id: number; result: HorizonResult }
  | { kind: typeof TerrainKind.View; id: number; result: ViewResult }
  | { kind: 'Error'; id: number; of: TerrainKind; error: string };
