import { Body, Equator, Horizon, Illumination, MoonPhase, type Observer } from 'astronomy-engine';
import { BODY, type SkyBody } from './bodies';
import { airDensity, apparentAltitude } from './refraction';

export interface HorizontalPos {
  /** Degrees clockwise from true north. */
  azimuth: number;
  /** Apparent altitude of the body's centre, degrees, refracted in the air at the observer's height. */
  altitude: number;
}

export function position(body: SkyBody, date: Date, obs: Observer): HorizontalPos {
  const eq = Equator(BODY[body], date, obs, true, true);
  const hor = Horizon(date, obs, eq.ra, eq.dec, '');
  return { azimuth: hor.azimuth, altitude: apparentAltitude(hor.altitude, airDensity(obs.height)) };
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

/** The lit lune drawn over the moon's disc: a semicircle closed by half an ellipse. */
export interface MoonTerminator {
  /** Half-width of the terminator ellipse, as a fraction of the disc radius. */
  rx: number;
  /** Past half phase the terminator bows away from the lit limb, so the lune covers more than half the disc. */
  gibbous: boolean;
  /** Side the lit limb faces in the frame: +1 right, -1 left. */
  litSide: 1 | -1;
}

export function moonTerminator(illumination: number, waxing: boolean): MoonTerminator {
  return { rx: Math.abs(2 * illumination - 1), gibbous: illumination > 0.5, litSide: waxing ? 1 : -1 };
}

/** Fraction of the disc the lune covers; equals the illumination when the terminator bows the right way. */
export function litAreaFraction(t: MoonTerminator): number {
  return 0.5 + (t.gibbous ? 0.5 : -0.5) * t.rx;
}

/** Equatorial radii, km; the Galactic Centre is a point. */
const BODY_RADIUS_KM: Record<SkyBody, number> = { Sun: 696_000, Moon: 1737.4, Gc: 0 };
const KM_PER_AU = 149_597_870.7;

/** Apparent angular radius at this instant, degrees; the moon's swings ±5 % over a month. */
export function semidiameterDeg(body: SkyBody, date: Date, obs: Observer): number {
  const r = BODY_RADIUS_KM[body];
  if (r === 0) return 0;
  const distKm = Equator(BODY[body], date, obs, true, true).dist * KM_PER_AU;
  return (Math.asin(r / distKm) * 180) / Math.PI;
}
