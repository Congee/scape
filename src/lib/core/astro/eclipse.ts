import { Body, Equator, GeoMoon, GeoVector, SearchLocalSolarEclipse, SearchLunarEclipse, type EclipseKind, type Observer } from 'astronomy-engine';
import { horizonAngleAt, type HorizonProfile } from '@core/terrain/horizon';
import { SkyBody } from './bodies';
import { position } from './positions';
import { SEMIDIAMETER_DEG } from './terrainEvents';

/** Contacts in NASA's naming: C1–C4 for the sun, P1/U1–U4/P4 for the moon. */
export const ContactKind = {
  C1: 'C1',
  C2: 'C2',
  C3: 'C3',
  C4: 'C4',
  P1: 'P1',
  U1: 'U1',
  U2: 'U2',
  U3: 'U3',
  U4: 'U4',
  P4: 'P4',
  Max: 'Max'
} as const;
export type ContactKind = (typeof ContactKind)[keyof typeof ContactKind];

export interface EclipseContact {
  kind: ContactKind;
  timeMs: number;
  /** Apparent altitude of the body's centre, degrees. */
  altitude: number;
  azimuth: number;
  /** Terrain skyline angle at the body's azimuth; null without a swept horizon. */
  skylineDeg: number | null;
  /** Upper limb above the skyline, or above the sea-level horizon without one. */
  visible: boolean;
}

export interface SolarCircumstances {
  kind: EclipseKind;
  /** NASA convention: fraction of the sun's diameter covered, or the moon/sun size ratio when central. */
  magnitude: number;
  /** Fraction of the sun's area covered at maximum. */
  obscuration: number;
  contacts: EclipseContact[];
}

export interface LunarCircumstances {
  kind: EclipseKind;
  umbralMagnitude: number;
  penumbralMagnitude: number;
  contacts: EclipseContact[];
}

const MINUTE_MS = 60_000;
const KM_PER_AU = 149_597_870.7;
const SUN_RADIUS_KM = 695_700;
const MOON_RADIUS_KM = 1737.4;
// astronomy-engine's shadow radius: mean Earth plus an 88 km atmosphere, close to the Danjon rule.
const EARTH_ECLIPSE_RADIUS_KM = 6459;
const DEG = 180 / Math.PI;

function contact(body: SkyBody, kind: ContactKind, timeMs: number, obs: Observer, horizon?: HorizonProfile): EclipseContact {
  const p = position(body, new Date(timeMs), obs);
  const skylineDeg = horizon ? horizonAngleAt(horizon, p.azimuth) : null;
  return { kind, timeMs, altitude: p.altitude, azimuth: p.azimuth, skylineDeg, visible: p.altitude + SEMIDIAMETER_DEG[body] > (skylineDeg ?? 0) };
}

function unit(ra: number, dec: number): [number, number, number] {
  const a = (ra * 15) / DEG;
  const d = dec / DEG;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
}

/** Topocentric solar eclipse magnitude at one instant. */
export function solarMagnitude(date: Date, obs: Observer): number {
  const s = Equator(Body.Sun, date, obs, true, true);
  const m = Equator(Body.Moon, date, obs, true, true);
  const rs = Math.asin(SUN_RADIUS_KM / (s.dist * KM_PER_AU));
  const rm = Math.asin(MOON_RADIUS_KM / (m.dist * KM_PER_AU));
  const [a, b] = [unit(s.ra, s.dec), unit(m.ra, m.dec)];
  const sep = Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  if (sep <= Math.abs(rm - rs)) return rm / rs;
  return Math.max(0, (rs + rm - sep) / (2 * rs));
}

/** Local circumstances of the first solar eclipse whose peak falls after `fromMs`, as seen from `obs`. */
export function solarCircumstances(obs: Observer, fromMs: number, horizon?: HorizonProfile): SolarCircumstances {
  const e = SearchLocalSolarEclipse(new Date(fromMs), obs);
  const at = (kind: ContactKind, t: { date: Date }) => contact(SkyBody.Sun, kind, t.date.getTime(), obs, horizon);
  const contacts = [at(ContactKind.C1, e.partial_begin.time)];
  if (e.total_begin) contacts.push(at(ContactKind.C2, e.total_begin.time));
  contacts.push(at(ContactKind.Max, e.peak.time));
  if (e.total_end) contacts.push(at(ContactKind.C3, e.total_end.time));
  contacts.push(at(ContactKind.C4, e.partial_end.time));
  return { kind: e.kind, magnitude: solarMagnitude(e.peak.time.date, obs), obscuration: e.obscuration, contacts };
}

/** Geocentric umbral and penumbral magnitudes, using astronomy-engine's shadow model. */
export function lunarMagnitudes(date: Date): { umbral: number; penumbral: number } {
  const s = GeoVector(Body.Sun, date, true);
  const m = GeoMoon(date);
  const dir = [-s.x, -s.y, -s.z];
  const u = (dir[0] * m.x + dir[1] * m.y + dir[2] * m.z) / (dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2);
  const r = KM_PER_AU * Math.hypot(u * dir[0] - m.x, u * dir[1] - m.y, u * dir[2] - m.z);
  const k = SUN_RADIUS_KM - (1 + u) * (SUN_RADIUS_KM - EARTH_ECLIPSE_RADIUS_KM);
  const p = -SUN_RADIUS_KM + (1 + u) * (SUN_RADIUS_KM + EARTH_ECLIPSE_RADIUS_KM);
  return { umbral: (k + MOON_RADIUS_KM - r) / (2 * MOON_RADIUS_KM), penumbral: (p + MOON_RADIUS_KM - r) / (2 * MOON_RADIUS_KM) };
}

/** Contacts of the first lunar eclipse whose peak falls after `fromMs`, with the moon's place as seen from `obs`. */
export function lunarCircumstances(obs: Observer, fromMs: number, horizon?: HorizonProfile): LunarCircumstances {
  const e = SearchLunarEclipse(new Date(fromMs));
  const peak = e.peak.date.getTime();
  const at = (kind: ContactKind, minutes: number) => contact(SkyBody.Moon, kind, peak + minutes * MINUTE_MS, obs, horizon);
  const contacts: EclipseContact[] = [at(ContactKind.P1, -e.sd_penum)];
  if (e.sd_partial > 0) contacts.push(at(ContactKind.U1, -e.sd_partial));
  if (e.sd_total > 0) contacts.push(at(ContactKind.U2, -e.sd_total));
  contacts.push(at(ContactKind.Max, 0));
  if (e.sd_total > 0) contacts.push(at(ContactKind.U3, e.sd_total));
  if (e.sd_partial > 0) contacts.push(at(ContactKind.U4, e.sd_partial));
  contacts.push(at(ContactKind.P4, e.sd_penum));
  const mag = lunarMagnitudes(e.peak.date);
  return { kind: e.kind, umbralMagnitude: mag.umbral, penumbralMagnitude: mag.penumbral, contacts };
}
