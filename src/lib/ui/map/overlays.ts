import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { DayEvent } from '@core/astro/dayEvents';
import type { HorizontalPos } from '@core/astro/positions';
import { geodesicPath, geodesicRay, type LngLat } from '@core/geo/geodesy';
import type { LosStatus } from '@core/terrain/los';

export const EVENT_COLORS = {
  sun: { rise: '#ffd84d', set: '#ff7a1a' },
  moon: { rise: '#9ccbff', set: '#2a63b8' },
  gc: { rise: '#d2bcff', set: '#8a5cf0' }
} as const;

export const LIVE_COLORS = { sun: '#f5a524', moon: '#5aa9ff', gc: '#b48cff', shadow: '#1c1c1c' } as const;

export const LOS_COLORS: Record<LosStatus | 'unknown', string> = {
  clear: '#2ecc71',
  marginal: '#f1c40f',
  blocked: '#ff5c5c',
  unknown: '#9aa7b4'
};

export interface LineProps {
  color: string;
  body: string;
  kind: string;
  terrain?: boolean;
}

const RISE_KINDS = new Set(['rise', 'terrainRise']);
const SET_KINDS = new Set(['set', 'terrainSet']);

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

/** Rise/set azimuth rays; terrain-adjusted ones carry `terrain: true` so the style can dash them. */
export function eventLines(pin: LngLat, events: DayEvent[], lengthM: number, o: EventLineOptions): FeatureCollection {
  const features = events
    .filter((e) => (RISE_KINDS.has(e.kind) || SET_KINDS.has(e.kind)) && (e.body !== 'gc' || o.showGc))
    .map((e) =>
      ray(pin, e.azimuth, lengthM, {
        color: EVENT_COLORS[e.body][RISE_KINDS.has(e.kind) ? 'rise' : 'set'],
        body: e.body,
        kind: e.kind,
        terrain: e.kind === 'terrainRise' || e.kind === 'terrainSet'
      })
    );
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

/** Great-circle sightline between the pins, coloured by line-of-sight status. */
export function geodeticLine(a: LngLat, b: LngLat, status: LosStatus | 'unknown'): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { color: LOS_COLORS[status], status },
        geometry: { type: 'LineString', coordinates: geodesicPath(a, b, 64) }
      }
    ]
  };
}
