import { Body, Equator, EquatorFromVector, GeoVector, Horizon, MakeTime, RotateVector, Rotation_EQJ_EQD, SiderealTime, type Observer } from 'astronomy-engine';
import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson';
import type { LngLat } from '@core/geo/geodesy';
import { airDensity, REFRACTION_NEAR_HORIZON_DEG } from './refraction';

const D2R = Math.PI / 180;
/** astronomy-engine's constants behind SearchRiseSet. */
const SUN_RADIUS_AU = 695_700 / 149_597_870.69098932;
const EARTH_FLATTENING = 0.996647180302104;
const EARTH_EQUATORIAL_RADIUS_KM = 6378.1366;
const MERCATOR_MAX_LAT = 85.051129;
const RING_START_SEGMENTS = 256;
const RING_MAX_DEPTH = 14;

/** Night-side regions, each inside the next: below the rise line, then below each twilight's sun altitude. */
export const NightBand = {
  Rise: 'rise',
  Civil: 'civil',
  Nautical: 'nautical',
  Astro: 'astro'
} as const;
export type NightBand = (typeof NightBand)[keyof typeof NightBand];

const TWILIGHT_ALT: Record<Exclude<NightBand, 'rise'>, number> = { [NightBand.Civil]: -6, [NightBand.Nautical]: -12, [NightBand.Astro]: -18 };

export interface NightCap {
  band: NightBand;
  /** Angular radius about the antisolar point, degrees. */
  radiusDeg: number;
}

export interface NightModel {
  antisolar: LngLat;
  /** Largest (the rise line) first. */
  caps: NightCap[];
}

const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** Great-circle angle between two points, degrees. */
export function angleDeg(a: LngLat, b: LngLat): number {
  const s = Math.sin(((b.lat - a.lat) * D2R) / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(((b.lng - a.lng) * D2R) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(s)))) / D2R;
}

/** astronomy-engine's HorizonDipAngle, which it does not export. */
export function horizonDipDeg(obs: Observer, aglM: number): number {
  const phi = obs.latitude * D2R;
  const sinphi = Math.sin(phi);
  const cosphi = Math.cos(phi);
  const c = 1 / Math.hypot(cosphi, sinphi * EARTH_FLATTENING);
  const s = c * EARTH_FLATTENING * EARTH_FLATTENING;
  const htKm = (obs.height - aglM) / 1000;
  const radiusM = 1000 * Math.hypot((EARTH_EQUATORIAL_RADIUS_KM * c + htKm) * cosphi, (EARTH_EQUATORIAL_RADIUS_KM * s + htKm) * sinphi);
  const k = 0.175 * Math.pow(1 - (6.5e-3 / 283.15) * (obs.height - (2 / 3) * aglM), 3.256);
  return -(Math.sqrt((2 * (1 - k) * aglM) / radiusM) / (1 - k)) / D2R;
}

/** Unrefracted upper-limb altitude at which SearchRiseSet reports sunrise and sunset. */
export function riseAltitudeDeg(obs: Observer, aglM: number): number {
  return horizonDipDeg(obs, aglM) - REFRACTION_NEAR_HORIZON_DEG * airDensity(obs.height - aglM);
}

/** Geocentric apparent subsolar point, true equator and equinox of date. */
export function subsolarPoint(date: Date): LngLat {
  const t = MakeTime(date);
  const eq = EquatorFromVector(RotateVector(Rotation_EQJ_EQD(t), GeoVector(Body.Sun, t, true)));
  return { lat: eq.dec, lng: wrap180((eq.ra - SiderealTime(t)) * 15) };
}

/**
 * Night caps as small circles about the antisolar point, offset so they pass through the camera
 * exactly when its topocentric sun reaches each altitude; elsewhere they are off by parallax alone.
 */
export function nightModel(date: Date, obs: Observer, aglM: number): NightModel {
  const sub = subsolarPoint(date);
  const t = MakeTime(date);
  const eq = Equator(Body.Sun, t, obs, true, true);
  const topo = Horizon(t, obs, eq.ra, eq.dec).altitude;
  const geo = 90 - angleDeg({ lat: obs.latitude, lng: obs.longitude }, sub);
  const off = topo - geo;
  const semi = Math.asin(SUN_RADIUS_AU / eq.dist) / D2R;
  const caps: NightCap[] = [{ band: NightBand.Rise, radiusDeg: 90 + riseAltitudeDeg(obs, aglM) - semi - off }];
  for (const [band, alt] of Object.entries(TWILIGHT_ALT)) caps.push({ band: band as NightBand, radiusDeg: 90 + alt - off });
  return { antisolar: { lat: -sub.lat, lng: wrap180(sub.lng + 180) }, caps };
}

/** How many caps contain a point: 0 is day, 4 is full night. */
export function bandIndex(m: NightModel, p: LngLat): number {
  const a = angleDeg(m.antisolar, p);
  return m.caps.filter((c) => a < c.radiusDeg).length;
}

/** Most any cap edge moves on a Web Mercator map `worldPx` wide between two models. */
export function nightShiftPx(a: NightModel, b: NightModel, worldPx: number): number {
  // Mercator stretches a latitude move by up to sec 85°.
  const lat = Math.abs(a.antisolar.lat - b.antisolar.lat) * 12;
  const r = Math.max(...a.caps.map((c, i) => Math.abs(c.radiusDeg - (b.caps[i]?.radiusDeg ?? Infinity)))) * 12;
  return ((Math.abs(wrap180(a.antisolar.lng - b.antisolar.lng)) + lat + r) / 360) * worldPx;
}

const mercY = (lat: number) => {
  const s = Math.sin(Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat)) * D2R);
  return Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

type Pos = [number, number];

/**
 * A small circle as a ring with continuous longitudes (they run past ±180 rather than jump), split
 * until every chord's midpoint is within `epsWorld` of the circle in Web Mercator world units.
 * `pole` is the pole the cap contains, if any; the ring then spans 360° of longitude.
 */
export function capRing(centre: LngLat, radiusDeg: number, epsWorld: number): { ring: Pos[]; pole: -1 | 0 | 1 } {
  const lat1 = centre.lat * D2R;
  const d = radiusDeg * D2R;
  const at = (theta: number, nearLng: number): Pos => {
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(theta));
    const dl = Math.atan2(Math.sin(theta) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    const lng = centre.lng + dl / D2R;
    return [nearLng + wrap180(lng - nearLng), lat2 / D2R];
  };
  const off = (p0: Pos, pm: Pos, p1: Pos) =>
    Math.hypot((pm[0] - (p0[0] + p1[0]) / 2) / 360, mercY(pm[1]) - (mercY(p0[1]) + mercY(p1[1])) / 2);
  const ring: Pos[] = [];
  const refine = (t0: number, p0: Pos, t1: number, p1: Pos, depth: number) => {
    const tm = (t0 + t1) / 2;
    const pm = at(tm, p0[0]);
    if (depth >= RING_MAX_DEPTH || off(p0, pm, p1) <= epsWorld) return;
    refine(t0, p0, tm, pm, depth + 1);
    ring.push(pm);
    refine(tm, pm, t1, p1, depth + 1);
  };
  let p0 = at(0, centre.lng);
  ring.push(p0);
  for (let i = 1; i <= RING_START_SEGMENTS; i++) {
    const t0 = (2 * Math.PI * (i - 1)) / RING_START_SEGMENTS;
    const t1 = (2 * Math.PI * i) / RING_START_SEGMENTS;
    const p1 = at(t1, p0[0]);
    refine(t0, p0, t1, p1, 0);
    ring.push(p1);
    p0 = p1;
  }
  const pole = 90 - centre.lat < radiusDeg ? 1 : 90 + centre.lat < radiusDeg ? -1 : 0;
  return { ring, pole };
}

/** A 360°-wide pole-cap ring rotated to run from one antimeridian to the other within ±180. */
export function cutAtAntimeridian(ring: Pos[]): Pos[] {
  const east = ring[ring.length - 1][0] > ring[0][0] ? ring : ring.toReversed();
  const shift = east[0][0] - wrap180(east[0][0]);
  const pts = east.slice(0, -1).map(([lng, lat]): Pos => [lng - shift, lat]);
  const i = pts.findIndex((p) => p[0] >= 180);
  if (i < 0) return [[-180, pts[0][1]], ...pts, [180, pts[0][1]]];
  const [a, b] = [pts[i - 1], pts[i]];
  const lat = a[1] + ((180 - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
  const after = pts.slice(i).map(([lng, la]): Pos => [lng - 360, la]);
  return [[-180, lat], ...after, ...pts.slice(0, i), [180, lat]];
}

/** The caps as polygons (a pole cap closed along the pole) and the rise line alone as a line. */
export function nightFeatures(m: NightModel, epsWorld: number): FeatureCollection<Polygon | LineString, { band: NightBand }> {
  const features: Feature<Polygon | LineString, { band: NightBand }>[] = [];
  for (const cap of m.caps) {
    const { ring, pole } = capRing(m.antisolar, cap.radiusDeg, epsWorld);
    const cut = pole ? cutAtAntimeridian(ring) : ring;
    const first = cut[0];
    const last = cut[cut.length - 1];
    const poly = pole ? [...cut, [last[0], pole * 90] as Pos, [first[0], pole * 90] as Pos, first] : ring;
    features.push({ type: 'Feature', properties: { band: cap.band }, geometry: { type: 'Polygon', coordinates: [poly] } });
    if (cap.band === NightBand.Rise) features.push({ type: 'Feature', properties: { band: cap.band }, geometry: { type: 'LineString', coordinates: cut } });
  }
  return { type: 'FeatureCollection', features };
}
