/** Moonlit sky brightness, Krisciunas & Schaefer (1991, PASP 103, 1033), V band. */

import { magToNl, nlToMag } from './brightness';

const D2R = Math.PI / 180;
/** V-band extinction coefficient, mag per airmass (K&S's Mauna Kea value). */
export const KS_EXTINCTION = 0.172;

/** K&S eq. 3 airmass; finite to the horizon. */
export const ksAirmass = (zenithDeg: number): number => 1 / Math.sqrt(1 - 0.96 * Math.sin(zenithDeg * D2R) ** 2);

/** K&S eq. 21 scattering function of the moon–sky separation ρ, degrees. */
export const ksScatter = (rhoDeg: number): number => 10 ** 5.36 * (1.06 + Math.cos(rhoDeg * D2R) ** 2) + 10 ** (6.15 - rhoDeg / 40);

/** K&S eqs. 8–9: the moon's illuminance above the atmosphere, in K&S's foot-candle-like units, from phase angle α. */
export const ksMoonIlluminance = (phaseAngleDeg: number): number => {
  const a = Math.abs(phaseAngleDeg);
  const m = -12.73 + 0.026 * a + 4e-9 * a ** 4;
  return 10 ** (-0.4 * (m + 16.57));
};

/** Phase angle from the illuminated fraction: 0° full, 180° new. */
export const phaseAngleDeg = (illumination: number): number => Math.acos(Math.max(-1, Math.min(1, 2 * illumination - 1))) / D2R;

export interface MoonSky {
  /** Sky brightness in that direction with the moon, mag/arcsec². */
  mag: number;
  /** Brightening over the moonless sky there, mag/arcsec² (≤ 0). */
  deltaMag: number;
}

/**
 * Sky brightness toward (skyAltDeg) at separation ρ from a moon at moonAltDeg. The dark sky is the site's zenith
 * value carried to that altitude with K&S eq. 2; a moon below the horizon adds nothing.
 */
export function moonlitSky(zenithMag: number, skyAltDeg: number, moonAltDeg: number, rhoDeg: number, illumination: number, k = KS_EXTINCTION): MoonSky {
  const z = 90 - Math.max(0, Math.min(90, skyAltDeg));
  const x = ksAirmass(z);
  const dark = magToNl(zenithMag) * 10 ** (-0.4 * k * (x - 1)) * x;
  let moon = 0;
  if (moonAltDeg > 0 && illumination > 0) {
    const xm = ksAirmass(90 - Math.min(90, moonAltDeg));
    moon = ksScatter(Math.max(rhoDeg, 0.5)) * ksMoonIlluminance(phaseAngleDeg(illumination)) * 10 ** (-0.4 * k * xm) * (1 - 10 ** (-0.4 * k * x));
  }
  const mag = nlToMag(dark + moon);
  return { mag, deltaMag: mag - nlToMag(dark) };
}

/** Angular separation of two horizontal directions, degrees. */
export function separationDeg(az1: number, alt1: number, az2: number, alt2: number): number {
  const c = Math.sin(alt1 * D2R) * Math.sin(alt2 * D2R) + Math.cos(alt1 * D2R) * Math.cos(alt2 * D2R) * Math.cos((az1 - az2) * D2R);
  return Math.acos(Math.max(-1, Math.min(1, c))) / D2R;
}
