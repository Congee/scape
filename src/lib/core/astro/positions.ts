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

/** Below this lit fraction the moon is new; above 1 minus it, full. */
export const MOON_NEW_MAX = 0.03;
/** Within this of half lit, a quarter. */
const QUARTER_BAND = 0.05;

/** The phase name every surface shows, from the lit fraction and the waxing flag. */
export function moonPhaseName(illumination: number, waxing: boolean): string {
  if (illumination < MOON_NEW_MAX) return 'New moon';
  if (illumination > 1 - MOON_NEW_MAX) return 'Full moon';
  if (Math.abs(illumination - 0.5) <= QUARTER_BAND) return waxing ? 'First quarter' : 'Last quarter';
  return `${waxing ? 'Waxing' : 'Waning'} ${illumination < 0.5 ? 'crescent' : 'gibbous'}`;
}

export function moonInfo(date: Date): MoonInfo {
  const phaseDeg = MoonPhase(date);
  const illumination = Illumination(Body.Moon, date).phase_fraction;
  const waxing = phaseDeg < 180;
  return { phaseDeg, illumination, waxing, name: moonPhaseName(illumination, waxing) };
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
