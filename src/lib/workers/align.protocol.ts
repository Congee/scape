import type { AlignPoint, Landmark } from '@core/align/alignment';
import type { SkyBody } from '@core/astro/bodies';
import type { LngLat } from '@core/geo/geodesy';
import type { HeatGrid } from '@core/geo/grid';

/** What the heat layer shows; Off computes nothing. */
export const HeatMode = { Off: 'Off', Viewshed: 'Viewshed', Visible: 'Visible', Align: 'Align', Time: 'Time' } as const;
export type HeatMode = (typeof HeatMode)[keyof typeof HeatMode];

/** Every mode that produces a grid. */
export type HeatModeOn = Exclude<HeatMode, typeof HeatMode.Off>;

export const AlignRequestKind = { Heat: 'Heat', Pick: 'Pick' } as const;
export type AlignRequestKind = (typeof AlignRequestKind)[keyof typeof AlignRequestKind];

export interface HeatParams {
  body: SkyBody;
  /** Centre of the grid: the landmark for Align/Time, the camera for Visible/Viewshed. */
  centre: LngLat;
  landmark: Landmark | null;
  eyeAboveGroundM: number;
  /** Centre of the time window, epoch ms. */
  timeMs: number;
  windowMin: number;
  /** Separation still counted as a hit, degrees. */
  toleranceDeg: number;
  offsetAzDeg: number;
  offsetAltDeg: number;
  rangeM: number;
  cells: number;
  minAltAboveTerrainDeg: number;
}

export interface HeatRequest extends HeatParams {
  kind: typeof AlignRequestKind.Heat;
  id: number;
  mode: HeatModeOn;
}

export interface PickRequest extends HeatParams {
  kind: typeof AlignRequestKind.Pick;
  id: number;
  point: LngLat;
}

export type AlignRequest = HeatRequest | PickRequest;

export const AlignResponseKind = { Heat: 'Heat', Pick: 'Pick', Error: 'Error' } as const;
export type AlignResponseKind = (typeof AlignResponseKind)[keyof typeof AlignResponseKind];

/** One candidate camera position with its coordinates. */
export type AlignCandidate = AlignPoint & LngLat;

export interface HeatResult {
  mode: HeatModeOn;
  grid: HeatGrid;
  /** Separation in degrees (Align/Time) or 1/0/NaN (Visible/Viewshed), row-major. */
  values: Float32Array;
  /** Offset of the best moment from the window centre, ms; null outside Align/Time. */
  dtMs: Float32Array | null;
  /** Largest value the grid reports. */
  capDeg: number;
  landmarkGroundM: number | null;
  elapsedMs: number;
}

export interface HeatResponse extends HeatResult {
  kind: typeof AlignResponseKind.Heat;
  id: number;
}

export interface PickResponse {
  kind: typeof AlignResponseKind.Pick;
  id: number;
  point: AlignCandidate | null;
}

export interface AlignError {
  kind: typeof AlignResponseKind.Error;
  id: number;
  message: string;
}

export type AlignResponse = HeatResponse | PickResponse | AlignError;
