const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const Orientation = { Landscape: 'Landscape', Portrait: 'Portrait' } as const;
export type Orientation = (typeof Orientation)[keyof typeof Orientation];

/** One teleconverter mounted between body and lens; the value is its multiplier. */
export const Teleconverter = { X14: 1.4, X20: 2 } as const;
export type Teleconverter = (typeof Teleconverter)[keyof typeof Teleconverter];

/** Combined multiplier of a mounted stack; 1 for none. Rounded so 1.4 × 2 reads 2.8, not 2.8000000000000003. */
export function tcFactor(list: readonly Teleconverter[]): number {
  return Math.round(list.reduce((p, t) => p * t, 1) * 100) / 100;
}

export interface SensorFormat {
  id: string;
  name: string;
  /** Long side, mm. */
  widthMm: number;
  /** Short side, mm. */
  heightMm: number;
  /** Pixels along the long side, when known (star-trail rules need the pixel pitch). */
  pixelsWide?: number;
  mount?: string;
}

export interface LensSpec {
  id: string;
  name: string;
  minMm: number;
  /** Equals `minMm` for a prime. */
  maxMm: number;
  /** Widest f-number at the short end. */
  maxAperture: number;
  /** Widest f-number at the long end; absent on a constant-aperture lens. */
  maxApertureLong?: number;
  mount: string;
}

/** Quick-pick focal lengths for a lens: its ends plus the presets that fall inside. */
export function lensFocals(lens: LensSpec, presets: number[]): number[] {
  return [...new Set([lens.minMm, ...presets.filter((f) => f > lens.minMm && f < lens.maxMm), lens.maxMm])].toSorted((a, b) => a - b);
}

/** True for a specific camera body (a catalogue pick or a custom one), false for a generic sensor format. */
export function isCameraBody(sensorId: string): boolean {
  return sensorId.startsWith('cat:') || sensorId.startsWith('custom:');
}

/** Only a zoom's two ends are quoted, and past the short end only the long-end value is certain. */
export function maxApertureAt(lens: LensSpec, focalMm: number): number {
  // Focals are rounded to 0.1 mm, which can land just past a fractional short end.
  const shortEnd = Math.max(lens.minMm, Math.round(lens.minMm * 10) / 10);
  return focalMm <= shortEnd + 1e-6 ? lens.maxAperture : (lens.maxApertureLong ?? lens.maxAperture);
}

/** Focal length and aperture pulled inside what the lens can do at that focal length. */
export function fitToLens(lens: LensSpec | null, focalMm: number, fNumber: number): { focalMm: number; fNumber: number } {
  if (!lens) return { focalMm, fNumber };
  const f = Math.round(Math.min(lens.maxMm, Math.max(lens.minMm, focalMm)) * 10) / 10;
  return { focalMm: f, fNumber: Math.max(fNumber, maxApertureAt(lens, f)) };
}

/** Standard stops the lens can reach, starting at its widest aperture at `focalMm`. */
export function aperturesFor(lens: LensSpec | null, focalMm?: number, stops: readonly number[] = F_STOPS): number[] {
  const widest = lens ? maxApertureAt(lens, focalMm ?? lens.minMm) : 0;
  return [...new Set([...(widest > 0 ? [widest] : []), ...stops.filter((f) => f > widest + 1e-9)])].toSorted((a, b) => a - b);
}

export const FULL_FRAME_DIAGONAL_MM = Math.hypot(36, 24);

export const SENSORS: SensorFormat[] = [
  { id: 'ff', name: 'Full frame 36×24', widthMm: 36, heightMm: 24 },
  { id: 'apsc', name: 'APS-C 23.5×15.6', widthMm: 23.5, heightMm: 15.6 },
  { id: 'apsc-canon', name: 'APS-C Canon 22.3×14.9', widthMm: 22.3, heightMm: 14.9 },
  { id: 'mft', name: 'Micro Four Thirds 17.3×13', widthMm: 17.3, heightMm: 13 },
  { id: 'mf44', name: 'Medium format 44×33', widthMm: 43.8, heightMm: 32.9 },
  { id: 'mf645', name: 'Medium format 645 56×41.5', widthMm: 56, heightMm: 41.5 },
  { id: 'one-inch', name: '1-inch 13.2×8.8', widthMm: 13.2, heightMm: 8.8 },
  { id: 'phone', name: 'Phone 1/1.3″ 9.6×7.2', widthMm: 9.6, heightMm: 7.2 },
  { id: 'lf45', name: 'Large format 4×5 120×96', widthMm: 120, heightMm: 96 }
];

export const DEFAULT_SENSOR_ID = 'ff';
export const MIN_FOCAL_MM = 4;
export const MAX_FOCAL_MM = 2400;
export const F_STOPS = [1, 1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22, 32];

export function sensorDiagonalMm(s: SensorFormat): number {
  return Math.hypot(s.widthMm, s.heightMm);
}

export function cropFactor(s: SensorFormat): number {
  return FULL_FRAME_DIAGONAL_MM / sensorDiagonalMm(s);
}

/** Zeiss-style circle of confusion scaled from 0.03 mm on full frame. */
export function circleOfConfusionMm(s: SensorFormat): number {
  return 0.03 / cropFactor(s);
}

export const CocRule = { Standard: 'standard', PixelPitch: 'pixel-pitch' } as const;
export type CocRule = (typeof CocRule)[keyof typeof CocRule];

/** Total pixels on a sensor, from the long-side count and square pixels. */
export function sensorPixels(s: SensorFormat): number | null {
  return s.pixelsWide ? (s.pixelsWide * s.pixelsWide * s.heightMm) / s.widthMm : null;
}

/**
 * Circle of confusion, mm. The pixel-pitch rule (PlanIt's “Large prints”) is twice the pitch
 * √(area / pixels); without a pixel count it falls back to the standard value.
 */
export function cocMm(s: SensorFormat, pixels: number | null | undefined, rule: CocRule): number {
  if (rule === CocRule.PixelPitch && pixels && pixels > 0) return 2 * Math.sqrt((s.widthMm * s.heightMm) / pixels);
  return circleOfConfusionMm(s);
}

export function equivalentFocalMm(s: SensorFormat, focalMm: number): number {
  return focalMm * cropFactor(s);
}

/** Frame dimensions in the chosen orientation: `w` is horizontal, `h` vertical. */
export function frameMm(s: SensorFormat, o: Orientation): { w: number; h: number } {
  return o === Orientation.Portrait ? { w: s.heightMm, h: s.widthMm } : { w: s.widthMm, h: s.heightMm };
}

/** Rectilinear angle of view across a side of `sizeMm`. */
export function fovDeg(sizeMm: number, focalMm: number): number {
  return 2 * Math.atan(sizeMm / (2 * focalMm)) * R2D;
}

export function focalForFovMm(sizeMm: number, fov: number): number {
  return sizeMm / (2 * Math.tan((fov / 2) * D2R));
}

export interface FrameFov {
  hDeg: number;
  vDeg: number;
  dDeg: number;
}

export function frameFov(s: SensorFormat, focalMm: number, o: Orientation): FrameFov {
  const { w, h } = frameMm(s, o);
  return { hDeg: fovDeg(w, focalMm), vDeg: fovDeg(h, focalMm), dDeg: fovDeg(Math.hypot(w, h), focalMm) };
}

/** Base focal on the lens, capped so the teleconverters' product still lands inside the frame range. */
export function clampBaseFocalMm(f: number, tc: number): number {
  return Math.min(MAX_FOCAL_MM / tc, Math.max(MIN_FOCAL_MM, f));
}

/** The one zoom rule: a base focal inside the mounted lens's own range as well as the frame range. */
export function clampFocalMm(focalMm: number, lens: LensSpec | null, tc: number): number {
  const f = lens ? Math.min(lens.maxMm, Math.max(lens.minMm, focalMm)) : focalMm;
  return Math.round(clampBaseFocalMm(f, tc) * 10) / 10;
}

/**
 * What the sensor actually sees. A teleconverter multiplies the focal length and costs the same
 * factor in light, so a 600/4 behind a 2.0× is a 1200/8; a stack multiplies through. Every optical
 * consumer wants these, not the stored base values.
 */
export function effectiveOptics(o: { focalMm: number; fNumber: number; teleconverters: readonly Teleconverter[] }): { focalMm: number; fNumber: number } {
  const tc = tcFactor(o.teleconverters);
  return { focalMm: Math.round(o.focalMm * tc * 10) / 10, fNumber: Math.round(o.fNumber * tc * 100) / 100 };
}

/**
 * Elevation angles the rim of a roll-free rectilinear frame reaches, degrees. The band is not
 * pitch ± vfov/2: along the bottom edge sin(el)'s numerator is fixed while its denominator grows
 * with |x|, so a frame pitched above the horizon dips lowest at a bottom *corner*. A steeply
 * pitched frame also turns over inside its own height, so that critical row is a candidate too.
 */
export function frameElevationSpanDeg(pitchDeg: number, frameWmm: number, frameHmm: number, focalMm: number): { minDeg: number; maxDeg: number } {
  const w = frameWmm / 2;
  const h = frameHmm / 2;
  const sp = Math.sin(pitchDeg * D2R);
  const cp = Math.cos(pitchDeg * D2R);
  let minDeg = Infinity;
  let maxDeg = -Infinity;
  // x enters only as x², so the two halves of the frame agree and the edge midpoints are x = 0.
  for (const x of [0, w]) {
    const yc = (cp * (focalMm * focalMm + x * x)) / (focalMm * sp);
    for (const y of [-h, h, Math.min(h, Math.max(-h, yc))]) {
      const el = Math.asin((y * cp + focalMm * sp) / Math.hypot(focalMm, x, y)) * R2D;
      if (el < minDeg) minDeg = el;
      if (el > maxDeg) maxDeg = el;
    }
  }
  return { minDeg, maxDeg };
}

/**
 * Half-width in azimuth of a roll-free rectilinear frame, degrees. Not `hfov / 2`: pitching the
 * frame shortens the forward component of the rays along the rim it tilts towards, and they splay
 * wider for it. Past the pitch where that component reaches zero the frame takes in every bearing.
 */
export function frameAzimuthHalfDeg(pitchDeg: number, frameWmm: number, frameHmm: number, focalMm: number): number {
  const p = pitchDeg * D2R;
  const fwd = focalMm * Math.cos(p) - (frameHmm / 2) * Math.abs(Math.sin(p));
  return fwd > 0 ? Math.atan(frameWmm / 2 / fwd) * R2D : 180;
}

/**
 * The same half-width, but as a function of the elevations a target spans, degrees. The wide
 * bearings of a pitched frame belong only to the rim it tilts towards, so a target that shares just
 * the far elevations of the frame is bracketed far more tightly than `frameAzimuthHalfDeg` allows.
 * Elevation rises with y and the forward component is linear in it, so the two move together and one
 * sampled pass over the part of the frame that still faces forward answers every query.
 */
export function frameAzimuthHalfCurve(pitchDeg: number, frameWmm: number, frameHmm: number, focalMm: number): (elLoDeg: number, elHiDeg: number) => number {
  const p = pitchDeg * D2R;
  const sp = Math.sin(p);
  const cp = Math.cos(p);
  const x = frameWmm / 2;
  const hy = frameHmm / 2;
  if (sp === 0) {
    const half = Math.atan(x / focalMm) * R2D;
    return () => half;
  }
  const yTurn = (focalMm * cp) / sp;
  const y0 = sp < 0 ? Math.max(-hy, yTurn) : -hy;
  const y1 = sp > 0 ? Math.min(hy, yTurn) : hy;
  if (!(y0 < y1)) return () => 180;
  // True when the turn, not the frame edge, ended the interval: past it every bearing is in.
  const open = sp < 0 ? y0 > -hy : y1 < hy;
  const n = 128;
  const el = new Float64Array(n + 1);
  const beta = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const y = y0 + ((y1 - y0) * i) / n;
    const fwd = focalMm * cp - y * sp;
    el[i] = Math.atan2(y * cp + focalMm * sp, Math.hypot(fwd, x)) * R2D;
    beta[i] = fwd > 0 ? Math.atan(x / fwd) * R2D : 90;
  }
  return (elLoDeg, elHiDeg) => {
    const want = sp < 0 ? elLoDeg : elHiDeg;
    if (want <= el[0]) return sp < 0 && open ? 180 : beta[0];
    if (want >= el[n]) return sp > 0 && open ? 180 : beta[n];
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (el[m] <= want) lo = m;
      else hi = m;
    }
    return beta[lo] + ((want - el[lo]) / (el[hi] - el[lo])) * (beta[hi] - beta[lo]);
  };
}
