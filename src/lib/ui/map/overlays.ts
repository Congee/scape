import type { Feature, FeatureCollection, LineString } from 'geojson';
import { SkyBody } from '@core/astro/bodies';
import { EventKind, type DayEvent } from '@core/astro/dayEvents';
import type { HorizontalPos } from '@core/astro/positions';
import { geodesicPath, geodesicRay, type LngLat } from '@core/geo/geodesy';
import type { LosStatus } from '@core/terrain/los';

export const LiveLineKind = { Live: 'Live', Shadow: 'Shadow' } as const;
export type LiveLineKind = (typeof LiveLineKind)[keyof typeof LiveLineKind];

export const EVENT_COLORS: Record<SkyBody, { rise: string; set: string }> = {
  Sun: { rise: '#ffd84d', set: '#ff7a1a' },
  Moon: { rise: '#9ccbff', set: '#2a63b8' },
  Gc: { rise: '#d2bcff', set: '#8a5cf0' }
};

export const LIVE_COLORS = { Sun: '#f5a524', Moon: '#5aa9ff', Gc: '#b48cff', Shadow: '#1c1c1c' } as const;

export const LOS_COLORS: Record<LosStatus | 'Unknown', string> = {
  Clear: '#2ecc71',
  Marginal: '#f1c40f',
  Blocked: '#ff5c5c',
  Unknown: '#9aa7b4'
};

export interface LineProps {
  color: string;
  body: string;
  kind: string;
  terrain?: boolean;
}

const RISE_KINDS = new Set<EventKind>([EventKind.Rise, EventKind.TerrainRise]);
const SET_KINDS = new Set<EventKind>([EventKind.Set, EventKind.TerrainSet]);

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
    .filter((e) => (RISE_KINDS.has(e.kind) || SET_KINDS.has(e.kind)) && (e.body !== SkyBody.Gc || o.showGc))
    .map((e) =>
      ray(pin, e.azimuth, lengthM, {
        color: EVENT_COLORS[e.body][RISE_KINDS.has(e.kind) ? 'rise' : 'set'],
        body: e.body,
        kind: e.kind,
        terrain: e.kind === EventKind.TerrainRise || e.kind === EventKind.TerrainSet
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
  pos: Record<SkyBody, HorizontalPos>,
  lengthM: number,
  o: LiveLineOptions
): FeatureCollection {
  const features: Feature<LineString, LineProps>[] = [];
  // Bodies count as up until their upper limb is below the horizon.
  if (pos.Sun.altitude > -0.833) features.push(ray(pin, pos.Sun.azimuth, lengthM, { color: LIVE_COLORS.Sun, body: SkyBody.Sun, kind: LiveLineKind.Live }));
  if (pos.Moon.altitude > -0.833) features.push(ray(pin, pos.Moon.azimuth, lengthM, { color: LIVE_COLORS.Moon, body: SkyBody.Moon, kind: LiveLineKind.Live }));
  if (o.showGc && pos.Gc.altitude > 0) features.push(ray(pin, pos.Gc.azimuth, lengthM, { color: LIVE_COLORS.Gc, body: SkyBody.Gc, kind: LiveLineKind.Live }));
  if (o.showShadow && pos.Sun.altitude > 0)
    features.push(ray(pin, pos.Sun.azimuth + 180, lengthM, { color: LIVE_COLORS.Shadow, body: SkyBody.Sun, kind: LiveLineKind.Shadow }));
  return { type: 'FeatureCollection', features };
}

/** Great-circle sightline from the camera to the target, coloured by line-of-sight status. */
export function geodeticLine(a: LngLat, b: LngLat, status: LosStatus | 'Unknown'): FeatureCollection {
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
