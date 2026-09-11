import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { DayEvent } from '@core/astro/dayEvents';
import type { HorizontalPos } from '@core/astro/positions';
import { geodesicRay, type LngLat } from '@core/geo/geodesy';

export const EVENT_COLORS = {
  sun: { rise: '#ffd84d', set: '#ff7a1a' },
  moon: { rise: '#9ccbff', set: '#2a63b8' },
  gc: { rise: '#d2bcff', set: '#8a5cf0' }
} as const;

export const LIVE_COLORS = { sun: '#f5a524', moon: '#5aa9ff', gc: '#b48cff', shadow: '#1c1c1c' } as const;

export interface LineProps {
  color: string;
  body: string;
  kind: string;
}

export function ray(pin: LngLat, azimuth: number, lengthM: number, props: LineProps): Feature<LineString, LineProps> {
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'LineString', coordinates: geodesicRay(pin, azimuth, lengthM, 48) }
  };
}

export interface EventLineOptions {
  showGc: boolean;
}

export function eventLines(pin: LngLat, events: DayEvent[], lengthM: number, o: EventLineOptions): FeatureCollection {
  const features = events
    .filter((e) => (e.kind === 'rise' || e.kind === 'set') && (e.body !== 'gc' || o.showGc))
    .map((e) => ray(pin, e.azimuth, lengthM, { color: EVENT_COLORS[e.body][e.kind as 'rise' | 'set'], body: e.body, kind: e.kind }));
  return { type: 'FeatureCollection', features };
}

export interface LiveLineOptions {
  showShadow: boolean;
  showGc: boolean;
}

export function liveLines(
  pin: LngLat,
  pos: { sun: HorizontalPos; moon: HorizontalPos; gc: HorizontalPos },
  lengthM: number,
  o: LiveLineOptions
): FeatureCollection {
  const features: Feature<LineString, LineProps>[] = [];
  // Bodies count as up until their upper limb is below the horizon.
  if (pos.sun.altitude > -0.833) features.push(ray(pin, pos.sun.azimuth, lengthM, { color: LIVE_COLORS.sun, body: 'sun', kind: 'live' }));
  if (pos.moon.altitude > -0.833) features.push(ray(pin, pos.moon.azimuth, lengthM, { color: LIVE_COLORS.moon, body: 'moon', kind: 'live' }));
  if (o.showGc && pos.gc.altitude > 0) features.push(ray(pin, pos.gc.azimuth, lengthM, { color: LIVE_COLORS.gc, body: 'gc', kind: 'live' }));
  if (o.showShadow && pos.sun.altitude > 0)
    features.push(ray(pin, pos.sun.azimuth + 180, lengthM, { color: LIVE_COLORS.shadow, body: 'sun', kind: 'shadow' }));
  return { type: 'FeatureCollection', features };
}
