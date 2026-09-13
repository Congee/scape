/** Ground shadow length of a vertical object of `heightM`; null while the sun is at or below the horizon. */
export function shadowLengthM(heightM: number, sunAltDeg: number): number | null {
  if (!(heightM > 0) || sunAltDeg <= 0) return null;
  return heightM / Math.tan((sunAltDeg * Math.PI) / 180);
}
