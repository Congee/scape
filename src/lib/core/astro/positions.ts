import { Body, Equator, Horizon, Illumination, MoonPhase, type Observer } from 'astronomy-engine';
import { BODY, type SkyBody } from './bodies';

export interface HorizontalPos {
  /** Degrees clockwise from true north. */
  azimuth: number;
  /** Apparent altitude of the body's centre, degrees, refraction included. */
  altitude: number;
}

export function position(body: SkyBody, date: Date, obs: Observer): HorizontalPos {
  const eq = Equator(BODY[body], date, obs, true, true);
  const hor = Horizon(date, obs, eq.ra, eq.dec, 'normal');
  return { azimuth: hor.azimuth, altitude: hor.altitude };
}

export interface MoonInfo {
  /** Ecliptic phase angle: 0 new, 90 first quarter, 180 full, 270 last quarter. */
  phaseDeg: number;
  /** Illuminated fraction 0..1. */
  illumination: number;
  waxing: boolean;
  name: string;
}

const PHASE_NAMES = [
  'New Moon',
  'Waxing Crescent',
  'First Quarter',
  'Waxing Gibbous',
  'Full Moon',
  'Waning Gibbous',
  'Last Quarter',
  'Waning Crescent'
];

export function moonInfo(date: Date): MoonInfo {
  const phaseDeg = MoonPhase(date);
  const illumination = Illumination(Body.Moon, date).phase_fraction;
  const idx = Math.round(phaseDeg / 45) % 8;
  return { phaseDeg, illumination, waxing: phaseDeg < 180, name: PHASE_NAMES[idx] };
}
