import type { FinderHit, FinderQuery } from '@core/astro/finder';
import type { LngLat } from '@core/geo/geodesy';
import type { HorizonProfile } from '@core/terrain/horizon';

export interface FinderRequest {
  id: number;
  pin: LngLat;
  heightAboveGroundM: number;
  query: FinderQuery;
  /** Terrain skyline the body must clear; null to ignore terrain. */
  horizon: HorizonProfile | null;
}

export const FinderResponseKind = { Progress: 'Progress', Done: 'Done', Error: 'Error' } as const;
export type FinderResponseKind = (typeof FinderResponseKind)[keyof typeof FinderResponseKind];

export interface FinderProgress {
  kind: typeof FinderResponseKind.Progress;
  id: number;
  /** Share of the date range scanned, 0..1. */
  fraction: number;
  /** Hits passing the filters so far. */
  hits: FinderHit[];
  /** Passes found so far, before the filters. */
  total: number;
}

export interface FinderDone {
  kind: typeof FinderResponseKind.Done;
  id: number;
  hits: FinderHit[];
  total: number;
  elapsedMs: number;
}

export interface FinderError {
  kind: typeof FinderResponseKind.Error;
  id: number;
  message: string;
}

export type FinderResponse = FinderProgress | FinderDone | FinderError;
