import type { TileCoord } from '@core/terrain/tiles';

export type DemRequest = { id: number; tile: TileCoord } | { id: number; cancel: true };

export type DemResponse =
  | { id: number; size: number; rgba: Uint8ClampedArray<ArrayBuffer>; cacheControl?: string; expires?: string }
  | { id: number; error: string };
