const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const Orientation = { Landscape: 'Landscape', Portrait: 'Portrait' } as const;
export type Orientation = (typeof Orientation)[keyof typeof Orientation];

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
  mount: string;
}

/** Quick-pick focal lengths for a lens: its ends plus the presets that fall inside. */
export function lensFocals(lens: LensSpec, presets: number[]): number[] {
  return [...new Set([lens.minMm, ...presets.filter((f) => f > lens.minMm && f < lens.maxMm), lens.maxMm])].toSorted((a, b) => a - b);
}

/** Standard stops the lens can reach, starting at its widest aperture. */
export function aperturesFor(lens: LensSpec | null, stops: readonly number[] = F_STOPS): number[] {
  if (!lens) return [...stops];
  return [...new Set([lens.maxAperture, ...stops.filter((f) => f > lens.maxAperture + 1e-9)])].toSorted((a, b) => a - b);
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

export function clampFocalMm(f: number): number {
  return Math.min(MAX_FOCAL_MM, Math.max(MIN_FOCAL_MM, f));
}
