/** Grey step 0 (night) to 9 (high day) for a sun altitude: twilight bands, golden hour, then day. */
const STEPS = [-18, -12, -6, -4, 0, 6, 12, 20, 35];

export function phaseStep(sunAltDeg: number): number {
  let n = 0;
  while (n < STEPS.length && sunAltDeg >= STEPS[n]) n++;
  return n;
}

/** The strip cell's lightness, in percent. */
export const phaseLightness = (step: number) => 8 + step * 8.5;
