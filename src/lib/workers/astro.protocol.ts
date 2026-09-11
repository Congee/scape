import type { DayCurve } from '@core/astro/dayCurve';
import type { DayEvent } from '@core/astro/dayEvents';
import type { LngLat } from '@core/geo/geodesy';
import type { HorizonProfile } from '@core/terrain/horizon';

export interface AstroRequest {
  id: number;
  pin: LngLat;
  heightAboveGroundM: number;
  startMs: number;
  endMs: number;
  goldenAltitude: number;
  /** When present, terrain rise/set events are added. */
  horizon?: HorizonProfile;
}

export interface AstroResponse {
  id: number;
  events: DayEvent[];
  curve: DayCurve;
}
