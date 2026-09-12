import { Equator, Refraction, SiderealTime, type Observer } from 'astronomy-engine';
import { normalizeBearing } from '@core/geo/geodesy';
import { BODY, type SkyBody } from './bodies';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** A body's apparent equatorial place at one instant, ready for many observers nearby. */
export interface SkySample {
  ms: number;
  /** Greenwich apparent sidereal time, hours. */
  gastH: number;
  raH: number;
  decDeg: number;
}

/** Topocentric place for `ref`; parallax differs by well under 0.02° within 100 km of it. */
export function skySample(body: SkyBody, ms: number, ref: Observer): SkySample {
  const date = new Date(ms);
  const eq = Equator(BODY[body], date, ref, true, true);
  return { ms, gastH: SiderealTime(date), raH: eq.ra, decDeg: eq.dec };
}

export interface FastHorizontal {
  azimuth: number;
  altitude: number;
}

/** Horizontal coordinates from a sample with a few trig calls instead of a full ephemeris. */
export function horizontalFast(s: SkySample, latDeg: number, lngDeg: number, refract = true): FastHorizontal {
  const H = (s.gastH + lngDeg / 15 - s.raH) * 15 * D2R;
  const φ = latDeg * D2R;
  const δ = s.decDeg * D2R;
  const sinφ = Math.sin(φ);
  const cosφ = Math.cos(φ);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);
  const cosH = Math.cos(H);
  let altitude = Math.asin(Math.max(-1, Math.min(1, sinφ * sinδ + cosφ * cosδ * cosH))) * R2D;
  const azimuth = normalizeBearing(Math.atan2(-Math.sin(H) * cosδ, sinδ * cosφ - cosδ * sinφ * cosH) * R2D);
  if (refract) altitude += Refraction('normal', altitude);
  return { azimuth, altitude };
}

/** Great-circle separation between two sky directions, degrees. */
export function separationDeg(az1: number, alt1: number, az2: number, alt2: number): number {
  const a1 = alt1 * D2R;
  const a2 = alt2 * D2R;
  const c = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos((az1 - az2) * D2R);
  return Math.acos(Math.max(-1, Math.min(1, c))) * R2D;
}
