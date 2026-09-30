import { distanceM, type LngLat } from '@core/geo/geodesy';

/** How far the pin may move on the map before the parked viewfinder lets its buildings go. */
export const VICINITY_M = 1000;

/** Whether the viewfinder parked at `at` keeps its uploaded buildings with the pin now at `pin`. */
export function keepParked(at: LngLat, pin: LngLat, lost: boolean, radiusM = VICINITY_M): boolean {
  return !lost && distanceM(at, pin) <= radiusM;
}
