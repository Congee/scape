import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { SkyBody } from '@core/astro/bodies';
import { EventKind, type DayEvent } from '@core/astro/dayEvents';
import type { HorizontalPos } from '@core/astro/positions';
import { riseApparentDeg } from '@core/astro/refraction';
import { shadowLengthM } from '@core/astro/shadow';
import { destination, geodesicPath, geodesicRay, type LngLat } from '@core/geo/geodesy';
import { MarkerCategory, type SavedMarker } from '@core/plan';
import type { LosStatus } from '@core/terrain/los';
import { Ink } from '../inks';

export const LiveLineKind = { Live: 'Live', Shadow: 'Shadow' } as const;
export type LiveLineKind = (typeof LiveLineKind)[keyof typeof LiveLineKind];

export const EVENT_COLORS: Record<SkyBody, { rise: string; set: string }> = {
  Sun: { rise: Ink.sunRise, set: Ink.sunSet },
  Moon: { rise: Ink.moonRise, set: Ink.moonSet },
  Gc: { rise: Ink.gcRise, set: Ink.gcSet }
};

export const LIVE_COLORS = { Sun: Ink.sun, Moon: Ink.moon, Gc: Ink.gc, Shadow: Ink.chartCivil } as const;
/** The viewfinder's umbral copper, which the live Moon line turns toward in a lunar eclipse. */
export const ECLIPSED_MOON_COLOR = Ink.eclipse;

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Live Moon blue mixed toward copper by the disc's umbra coverage, 0..1. */
export function eclipsedMoonColor(umbra: number): string {
  const a = rgbOf(LIVE_COLORS.Moon);
  const b = rgbOf(ECLIPSED_MOON_COLOR);
  const t = Math.min(1, Math.max(0, umbra));
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

export const LOS_COLORS: Record<LosStatus | 'Unknown', string> = {
  Clear: Ink.losClear,
  Marginal: Ink.losMarginal,
  Blocked: Ink.losBlocked,
  Unknown: Ink.losUnknown
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
  /** Air at the eye relative to sea level, which `pos` was refracted in. */
  airDensity: number;
  showShadow: boolean;
  showGc: boolean;
  /** Height of the object casting the shadow at the camera, metres. */
  shadowHeightM: number;
  /** Target location and its height, for a second shadow cast there. */
  pin2?: LngLat | null;
  pin2HeightM?: number;
  /** Fraction of the Moon's disc inside Earth's umbra. */
  moonUmbra?: number;
}

/** Near the horizon the true shadow runs off any useful map, so the drawn ray stops here. */
const MAX_SHADOW_M = 50_000;

export function liveLines(
  pin: LngLat,
  pos: Record<SkyBody, HorizontalPos>,
  lengthM: number,
  o: LiveLineOptions
): FeatureCollection {
  const features: Feature<LineString, LineProps>[] = [];
  // Bodies count as up until their upper limb is below the horizon.
  const rise = riseApparentDeg(o.airDensity);
  if (pos.Sun.altitude > rise) features.push(ray(pin, pos.Sun.azimuth, lengthM, { color: LIVE_COLORS.Sun, body: SkyBody.Sun, kind: LiveLineKind.Live }));
  if (pos.Moon.altitude > rise) features.push(ray(pin, pos.Moon.azimuth, lengthM, { color: eclipsedMoonColor(o.moonUmbra ?? 0), body: SkyBody.Moon, kind: LiveLineKind.Live }));
  if (o.showGc && pos.Gc.altitude > 0) features.push(ray(pin, pos.Gc.azimuth, lengthM, { color: LIVE_COLORS.Gc, body: SkyBody.Gc, kind: LiveLineKind.Live }));
  if (o.showShadow) {
    const away = pos.Sun.azimuth + 180;
    const shadow = (at: LngLat, heightM: number) => {
      const len = shadowLengthM(heightM, pos.Sun.altitude);
      if (len == null) return;
      features.push(ray(at, away, Math.min(len, MAX_SHADOW_M), { color: LIVE_COLORS.Shadow, body: SkyBody.Sun, kind: LiveLineKind.Shadow }));
    };
    shadow(pin, o.shadowHeightM);
    if (o.pin2 && (o.pin2HeightM ?? 0) > 0) shadow(o.pin2, o.pin2HeightM!);
  }
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

export const FovKind = { Fill: 'Fill', Edge: 'Edge', Axis: 'Axis', Dof: 'Dof', Pano: 'Pano' } as const;
export type FovKind = (typeof FovKind)[keyof typeof FovKind];

export interface FovConeOptions {
  rangeM: number;
  /** Depth-of-field limits drawn as arcs across the cone, metres from the camera. */
  dofNearM?: number | null;
  dofFarM?: number | null;
  /** Total panorama angle drawn as a wider dashed outline. */
  panoDeg?: number | null;
}

function arc(pin: LngLat, fromDeg: number, toDeg: number, distM: number, segments: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const p = destination(pin, fromDeg + ((toDeg - fromDeg) * i) / segments, distM);
    pts.push([p.lng, p.lat]);
  }
  return pts;
}

function cone(pin: LngLat, azimuthDeg: number, spanDeg: number, rangeM: number): [number, number][] {
  const left = geodesicRay(pin, azimuthDeg - spanDeg / 2, rangeM, 16);
  const right = geodesicRay(pin, azimuthDeg + spanDeg / 2, rangeM, 16);
  return [...left, ...arc(pin, azimuthDeg - spanDeg / 2, azimuthDeg + spanDeg / 2, rangeM, Math.max(8, Math.ceil(spanDeg / 3))).slice(1, -1), ...right.toReversed()];
}

/** Field-of-view cone from the camera: filled wedge, edges, axis, depth-of-field arcs and panorama outline. */
export function fovCone(pin: LngLat, azimuthDeg: number, hfovDeg: number, o: FovConeOptions): FeatureCollection {
  const features: Feature<Polygon | LineString, { kind: FovKind }>[] = [];
  const ring = cone(pin, azimuthDeg, hfovDeg, o.rangeM);
  features.push({ type: 'Feature', properties: { kind: FovKind.Fill }, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } });
  for (const side of [-1, 1]) {
    features.push({ type: 'Feature', properties: { kind: FovKind.Edge }, geometry: { type: 'LineString', coordinates: geodesicRay(pin, azimuthDeg + (side * hfovDeg) / 2, o.rangeM, 16) } });
  }
  features.push({ type: 'Feature', properties: { kind: FovKind.Axis }, geometry: { type: 'LineString', coordinates: geodesicRay(pin, azimuthDeg, o.rangeM, 16) } });
  for (const d of [o.dofNearM, o.dofFarM]) {
    if (d == null || !Number.isFinite(d) || d <= 0 || d > o.rangeM) continue;
    features.push({ type: 'Feature', properties: { kind: FovKind.Dof }, geometry: { type: 'LineString', coordinates: arc(pin, azimuthDeg - hfovDeg / 2, azimuthDeg + hfovDeg / 2, d, 12) } });
  }
  if (o.panoDeg != null && o.panoDeg > hfovDeg) {
    const outline = cone(pin, azimuthDeg, Math.min(o.panoDeg, 359), o.rangeM);
    features.push({ type: 'Feature', properties: { kind: FovKind.Pano }, geometry: { type: 'LineString', coordinates: [...outline, outline[0]] } });
  }
  return { type: 'FeatureCollection', features };
}

export const CATEGORY_COLORS: Record<MarkerCategory, string> = {
  Peak: Ink.markerPeak,
  Building: Ink.markerBuilding,
  Tree: Ink.markerTree,
  Lighthouse: Ink.markerLighthouse,
  Bridge: Ink.markerBridge,
  Waterfall: Ink.markerWaterfall,
  Viewpoint: Ink.markerViewpoint,
  Other: Ink.markerOther
};

export interface MarkerFeatureProps {
  id: string;
  name: string;
  category: MarkerCategory;
  color: string;
  selected: boolean;
}

export function markerFeatures(markers: SavedMarker[], selectedId: string | null): FeatureCollection<Point, MarkerFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: markers.map((m) => ({
      type: 'Feature',
      id: m.id,
      properties: { id: m.id, name: m.name, category: m.category, color: CATEGORY_COLORS[m.category] ?? CATEGORY_COLORS.Other, selected: m.id === selectedId },
      geometry: { type: 'Point', coordinates: [m.lng, m.lat] }
    }))
  };
}
