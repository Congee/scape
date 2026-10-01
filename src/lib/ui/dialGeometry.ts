/** Radius of the 14px bearing dial's needle, in its -7..7 viewBox. */
export const DIAL_R = 6;

/** Needle tip for an azimuth in degrees from north, clockwise; SVG y grows downward. */
export function needleEnd(azDeg: number, r = DIAL_R): { x: number; y: number } {
  const a = (azDeg * Math.PI) / 180;
  return { x: r * Math.sin(a), y: -r * Math.cos(a) };
}
