import { Equator, Horizon, HourAngle, type Observer } from 'astronomy-engine';
import { POLARIS_BODY } from './bodies';
import { airDensity, apparentAltitude } from './refraction';

export interface PolarisAid {
  /** Observer in the northern hemisphere, where Polaris serves. */
  northern: boolean;
  /** Altitude of the celestial pole, degrees (equals |latitude|). */
  poleAltDeg: number;
  poleAzDeg: number;
  polarisAzDeg: number;
  polarisAltDeg: number;
  /** Polaris' distance from the true pole at this date, degrees. */
  separationDeg: number;
  /** Local hour angle of Polaris, hours 0..24. */
  hourAngleH: number;
  /** Clock position of Polaris around the pole as seen in the sky (12 = straight above the pole). */
  clockSky: number;
  /** Same for an inverting (straight-through) polar scope. */
  clockScope: number;
}

const toClock = (h: number) => {
  const c = ((h % 12) + 12) % 12;
  return c === 0 ? 12 : c;
};

/** Where Polaris sits relative to the pole, for polar alignment; hour angle grows westward, so the sky clock runs backwards. */
export function polarisAid(time: Date, obs: Observer): PolarisAid {
  const eq = Equator(POLARIS_BODY, time, obs, true, true);
  const hor = Horizon(time, obs, eq.ra, eq.dec, '');
  const ha = HourAngle(POLARIS_BODY, time, obs);
  const clockSky = toClock(12 - ha / 2);
  return {
    northern: obs.latitude >= 0,
    poleAltDeg: Math.abs(obs.latitude),
    poleAzDeg: obs.latitude >= 0 ? 0 : 180,
    polarisAzDeg: hor.azimuth,
    polarisAltDeg: apparentAltitude(hor.altitude, airDensity(obs.height)),
    separationDeg: 90 - eq.dec,
    hourAngleH: ha,
    clockSky,
    clockScope: toClock(clockSky + 6)
  };
}
