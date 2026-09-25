import type { TileCoord } from '@core/terrain/tiles';

/** What a tile comes back as: padded pixels for our own source, or encoded bytes for MapLibre's. */
export const DemFormat = { Pixels: 'pixels', Encoded: 'encoded' } as const;
export type DemFormat = (typeof DemFormat)[keyof typeof DemFormat];

export type DemRequest = { id: number; tile: TileCoord; format: DemFormat } | { id: number; cancel: true };

interface Freshness {
  cacheControl?: string;
  expires?: string;
}

export interface DemPixels extends Freshness {
  id: number;
  format: typeof DemFormat.Pixels;
  size: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

export interface DemEncoded extends Freshness {
  id: number;
  format: typeof DemFormat.Encoded;
  data: ArrayBuffer;
}

export type DemResponse = DemPixels | DemEncoded | { id: number; error: string };
