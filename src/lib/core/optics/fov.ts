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

/**
 * Widest f-number this lens reaches at `focalMm`, running straight in log2(f-number) against
 * log2(focal) and holding at the endpoints outside the range. Only the two ends are quoted data:
 * between them this is a model, and a real zoom holds its wider end for part of the range and then
 * steps. Label interior values as approximate wherever they are shown.
 */
export function maxApertureAt(lens: LensSpec, focalMm: number): number {
  const long = lens.maxApertureLong;
  if (!long || lens.maxMm <= lens.minMm) return lens.maxAperture;
  const t = (Math.log2(focalMm) - Math.log2(lens.minMm)) / (Math.log2(lens.maxMm) - Math.log2(lens.minMm));
  const u = Math.min(1, Math.max(0, t));
  return Math.round(2 ** (Math.log2(lens.maxAperture) + u * (Math.log2(long) - Math.log2(lens.maxAperture))) * 10) / 10;
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
