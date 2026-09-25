/** Deep link to DarkHours (MIT, github.com/mbeher2200/DarkHours) for a point's night. */

import type { LngLat } from '@core/geo/geodesy';
import { addLocalDays, isoDate, localParts } from '@core/time/localDay';

/** The local date whose evening starts the night holding `instant`: before noon counts as last night. */
export function localNightDate(instant: Date, tz: string): string {
  const p = localParts(instant, tz);
  return isoDate(p.hour < 12 ? localParts(addLocalDays(instant, -1, tz), tz) : p);
}

export const darkHoursUrl = (p: LngLat, instant: Date, tz: string): string =>
  `https://darkhours.app/?lat=${p.lat.toFixed(5)}&lon=${p.lng.toFixed(5)}&date=${localNightDate(instant, tz)}`;
