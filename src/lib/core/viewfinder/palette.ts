/** Sky and ground colours of the synthetic view, shared by the CPU raster and its GPU port. */

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export const mix = (a: readonly number[], b: readonly number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Fixed ends of every ramp; the shader carries the same numbers as constants. */
export const SKY = {
  zenithDay: [46, 96, 168],
  horizonDay: [176, 205, 232],
  zenithNight: [6, 9, 18],
  horizonNight: [22, 30, 48],
  duskGlow: [236, 132, 72],
  groundNearNight: [18, 22, 24],
  groundNearDay: [86, 96, 70],
  groundFarNight: [26, 34, 52],
  groundFarDay: [150, 170, 200]
} as const;

/** Same haze falloff the building shading uses. */
export const GROUND_HAZE_M = 45_000;

export interface Palette {
  /** Daylight and dusk weights the ramps are mixed by; the shader takes these two scalars. */
  day: number;
  dusk: number;
  groundNear: number[];
  groundFar: number[];
  skyAt(altDeg: number): number[];
  groundAt(distM: number, slope: number): number[];
}

export function palette(sunAlt: number): Palette {
  const day = smooth(-12, 4, sunAlt);
  const dusk = smooth(-10, -3, sunAlt) * (1 - smooth(-1, 6, sunAlt));
  const groundNear = mix(SKY.groundNearNight, SKY.groundNearDay, day);
  const groundFar = mix(SKY.groundFarNight, SKY.groundFarDay, day);
  const skyAt = (alt: number) => {
    const t = smooth(0, 60, alt);
    let c = mix(mix(SKY.horizonNight, SKY.zenithNight, t), mix(SKY.horizonDay, SKY.zenithDay, t), day);
    const glow = dusk * (1 - smooth(0, 18, alt));
    c = mix(c, SKY.duskGlow, glow * 0.6);
    return c;
  };
  const groundAt = (distM: number, slope: number) => {
    const haze = 1 - Math.exp(-distM / GROUND_HAZE_M);
    const c = mix(groundNear, groundFar, haze);
    const shade = 0.75 + 0.5 * clamp(slope, 0, 1);
    return [c[0] * shade, c[1] * shade, c[2] * shade];
  };
  return { day, dusk, groundNear, groundFar, skyAt, groundAt };
}
