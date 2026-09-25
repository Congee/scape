import type { GibsWindow } from '@core/sky/gibs';
import type { LngLat } from '@core/geo/geodesy';
import type { ViirsWindow } from '@core/sky/viirs';

export interface GibsRequest {
  id: number;
  p: LngLat;
  win: Omit<ViirsWindow, 'data'>;
  nowMs: number;
}

export const GibsOutcome = { Ready: 'Ready', Offline: 'Offline', Error: 'Error' } as const;
export type GibsOutcome = (typeof GibsOutcome)[keyof typeof GibsOutcome];

export type GibsResponse =
  | {
      id: number;
      outcome: typeof GibsOutcome.Ready;
      win: GibsWindow;
      /** Nights with any tile, newest first. */
      nights: string[];
      /** Tiles and bytes this request downloaded; the rest came from the cache. */
      fetchedTiles: number;
      fetchedBytes: number;
      tiles: number;
    }
  | { id: number; outcome: typeof GibsOutcome.Offline }
  | { id: number; outcome: typeof GibsOutcome.Error; error: string };
