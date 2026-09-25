/** Sky-brightness units and the Bortle class of a zenith brightness. */

/** Natural moonless zenith sky, V mag/arcsec² (airglow, zodiacal light and starlight). */
export const NATURAL_SKY_MAG = 22.0;

/** mag/arcsec² → cd/m²; 10.8e4 cd/m² is 0 mag/arcsec² in V (Garstang 1986). */
export const magToCdm2 = (mag: number): number => 10.8e4 * 10 ** (-0.4 * mag);
export const cdm2ToMag = (cdm2: number): number => -2.5 * Math.log10(cdm2 / 10.8e4);

/** mag/arcsec² → nanolamberts, Krisciunas & Schaefer (1991) eq. 1. */
export const magToNl = (mag: number): number => 34.08 * Math.exp(20.7233 - 0.92104 * mag);
export const nlToMag = (nl: number): number => (20.7233 - Math.log(nl / 34.08)) / 0.92104;

/** Naked-eye limiting magnitude from sky brightness (Schaefer 1990 form, as DarkHours uses it). */
export const nelmFromSqm = (mag: number): number => 7.93 - 5 * Math.log10(10 ** (4.316 - mag / 5) + 1);

export interface Bortle {
  /** Class 1–8; half classes where the table has one (4.5). */
  cls: number;
  label: string;
}

// Dark Skies Awareness (IYA2009) nomogram, as tabulated in Wikipedia's "Bortle scale": lower SQM bound per class.
const TABLE: [number, number, string][] = [
  [21.76, 1, '1'],
  [21.6, 2, '2'],
  [21.3, 3, '3'],
  [20.8, 4, '4'],
  [20.3, 4.5, '4.5'],
  [19.25, 5, '5'],
  [18.5, 6, '6'],
  [18.0, 7, '7']
];

export function bortleOf(mag: number): Bortle {
  for (const [lo, cls, label] of TABLE) if (mag >= lo) return { cls, label };
  return { cls: 8, label: '8–9' };
}
