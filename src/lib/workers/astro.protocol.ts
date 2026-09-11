import type { DayCurve } from '@core/astro/dayCurve';
import type { DayEvent } from '@core/astro/dayEvents';
import type { LngLat } from '@core/geo/geodesy';

export interface AstroRequest {
  id: number;
  pin: LngLat;
  heightAboveGroundM: number;
  startMs: number;
  endMs: number;
  goldenAltitude: number;
}

export interface AstroResponse {
  id: number;
  events: DayEvent[];
  curve: DayCurve;
}
