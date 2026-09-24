import type { DayCurve } from '@core/astro/dayCurve';
import type { DayEvent } from '@core/astro/dayEvents';
import type { MilkyWayOptions, MilkyWayWindow } from '@core/astro/milkyWay';
import type { LngLat } from '@core/geo/geodesy';
import type { HorizonProfile } from '@core/terrain/horizon';

export interface AstroRequest {
  id: number;
  pin: LngLat;
  /** Sampled ground under the pin, metres; null when unknown. */
  groundM: number | null;
  /** Eye height above that ground, metres. */
  heightAboveGroundM: number;
  startMs: number;
  endMs: number;
  goldenAltitude: number;
  milkyWay: MilkyWayOptions;
  /** When present, terrain rise/set events are added. */
  horizon?: HorizonProfile;
}

export interface AstroResponse {
  id: number;
  events: DayEvent[];
  curve: DayCurve;
  milkyWay: MilkyWayWindow[];
}
