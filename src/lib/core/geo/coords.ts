import type { Digits, LngLat } from './geodesy';

// Values are persisted in settings.
export const CoordFormat = { DD: 'dd', DM: 'dm', DMS: 'dms', Signed: 'signed' } as const;
export type CoordFormat = (typeof CoordFormat)[keyof typeof CoordFormat];

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

function fmtOne(value: number, pos: string, neg: string, format: Exclude<CoordFormat, typeof CoordFormat.Signed>): string {
  const hemi = value < 0 ? neg : pos;
  const v = Math.abs(value);
  if (format === CoordFormat.DD) return `${v.toFixed(4)}°${hemi}`;
  const d = Math.floor(v);
  const mFloat = (v - d) * 60;
  if (format === CoordFormat.DM) return `${d}°${mFloat.toFixed(3)}′${hemi}`;
  const m = Math.floor(mFloat);
  const s = (mFloat - m) * 60;
  return `${d}°${pad(m, 2)}′${pad(Number(s.toFixed(1)), 4)}″${hemi}`;
}

export function formatLngLat(p: LngLat, format: CoordFormat = CoordFormat.Signed): string {
  if (format === CoordFormat.Signed) return formatDecimal(p);
  return `${fmtOne(p.lat, 'N', 'S', format)} ${fmtOne(p.lng, 'E', 'W', format)}`;
}

/** Text for the clipboard: the same string as shown. */
export function copyLngLat(p: LngLat, format: CoordFormat = CoordFormat.Signed): string {
  return formatLngLat(p, format);
}

/** Shown for points of unknown precision, with trailing zeros dropped. */
export const UNKNOWN_DIGITS = 6;
// Doubles keep ~15 significant digits, so more decimals than this would print float noise.
const MAX_DIGITS = 12;
const MAX_PIXEL_DIGITS = 7;
// 512 px MapLibre tiles: the world is 512 * 2^zoom CSS pixels wide.
const WORLD_PX_AT_Z0 = 512;
const EPS = 1e-9;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Decimals as written: `44.470` is 3, `-72` is 0. */
export function textDigits(s: string): number {
  const t = s.trim();
  const dot = t.indexOf('.');
  return dot < 0 ? 0 : clamp(t.length - dot - 1, 0, MAX_DIGITS);
}

/** Decimals of a number's shortest form, for providers that send JSON numbers. */
export function numberDigits(n: number): number {
  const m = /^-?\d+(?:\.(\d+))?(?:e([+-]\d+))?$/i.exec(String(n));
  if (!m) return UNKNOWN_DIGITS;
  return clamp((m[1]?.length ?? 0) - Number(m[2] ?? 0), 0, MAX_DIGITS);
}

/** Point with digits from its own number forms. */
export function withNumberDigits<T extends LngLat>(p: T): T {
  return { ...p, digits: { lat: numberDigits(p.lat), lng: numberDigits(p.lng) } };
}

/** Decimals that resolve one CSS pixel at `zoom`, per axis. */
export function pixelDigits(lat: number, zoom: number): Digits {
  const lngPerPx = 360 / (WORLD_PX_AT_Z0 * 2 ** zoom);
  const latPerPx = lngPerPx * Math.cos((lat * Math.PI) / 180);
  const digits = (deg: number) => clamp(Math.ceil(-Math.log10(deg) - EPS), 0, MAX_PIXEL_DIGITS);
  return { lat: digits(latPerPx), lng: digits(lngPerPx) };
}

/** A point picked on the map at `zoom`, rounded to the digits it resolves so a link reads back the same point. */
export function atPixel(p: LngLat, zoom: number): LngLat {
  const digits = pixelDigits(p.lat, zoom);
  return { lat: Number(p.lat.toFixed(digits.lat)), lng: Number(p.lng.toFixed(digits.lng)), digits };
}

function fmtAxis(v: number, digits: number | undefined): string {
  if (digits !== undefined) return v.toFixed(digits);
  return v.toFixed(UNKNOWN_DIGITS).replace(/\.?0+$/, '');
}

/** Signed `lat,lng` at the point's known digits, suitable for pasting into other tools. */
export function formatDecimal(p: LngLat): string {
  return `${fmtAxis(p.lat, p.digits?.lat)},${fmtAxis(p.lng, p.digits?.lng)}`;
}

/** Accepts a Google Maps URL or fragment and a trailing zoom suffix. */
function normalize(text: string): string {
  let t = text.trim().replace(/[−–]/g, '-');
  const at = t.lastIndexOf('@');
  if (at >= 0) t = t.slice(at + 1);
  return t.replace(/,\s*\d+(?:\.\d+)?z\b.*$/i, '').trim();
}

const NUM = String.raw`(-?\d+(?:\.\d+)?)`;
const SEP = String.raw`[°:\s]*`;
// One coordinate in D, D M, or D M S form with optional hemisphere letter on either side.
const ONE = String.raw`([NSEW])?\s*${NUM}${SEP}(?:(\d+(?:\.\d+)?)['′:\s]*)?(?:(\d+(?:\.\d+)?)["″]?)?\s*([NSEW])?`;
const PAIR = new RegExp(String.raw`^\s*${ONE}\s*[,;/\s]\s*${ONE}\s*$`, 'i');

/**
 * Parse "40.7463,-74.1553", "40.7463, -74.1553", "40°44'46.7\"N 74°09'19.1\"W", "N40 44.78 W74 09.32" and similar.
 * Returns null when the text is not a coordinate pair.
 */
export function parseLngLat(text: string): LngLat | null {
  const m = PAIR.exec(normalize(text));
  if (!m) return null;
  const a = toDeg(m[1], m[2], m[3], m[4], m[5]);
  const b = toDeg(m[6], m[7], m[8], m[9], m[10]);
  if (a === null || b === null) return null;
  // Decide which is latitude: hemisphere letters win, else assume "lat, lng".
  const [la, ln] = a.axis === 'lng' || b.axis === 'lat' ? [b, a] : [a, b];
  if (Math.abs(la.value) > 90 || Math.abs(ln.value) > 180) return null;
  return { lat: la.value, lng: ln.value, digits: { lat: la.digits, lng: ln.digits } };
}

function toDeg(
  pre: string | undefined,
  d: string,
  m: string | undefined,
  s: string | undefined,
  post: string | undefined
): { value: number; axis: 'lat' | 'lng' | null; digits: number } | null {
  const hemi = (pre || post || '').toUpperCase();
  if (pre && post) return null;
  const deg = parseFloat(d);
  if (Number.isNaN(deg)) return null;
  let value = Math.abs(deg) + (m ? parseFloat(m) / 60 : 0) + (s ? parseFloat(s) / 3600 : 0);
  if ((m || s) && (parseFloat(m ?? '0') >= 60 || parseFloat(s ?? '0') >= 60)) return null;
  const negative = deg < 0 || d.startsWith('-') || hemi === 'S' || hemi === 'W';
  if (negative) value = -value;
  const axis = hemi === 'N' || hemi === 'S' ? 'lat' : hemi === 'E' || hemi === 'W' ? 'lng' : null;
  return { value, axis, digits: partDigits(d, m, s) };
}

/** Decimal-degree digits matching the finest written part: a minute is 1/60°, a second 1/3600°. */
function partDigits(d: string, m: string | undefined, s: string | undefined): number {
  if (!m && !s) return textDigits(d);
  const [last, per] = s ? [s, 3600] : [m!, 60];
  return clamp(Math.ceil(textDigits(last) + Math.log10(per) - EPS), 0, MAX_DIGITS);
}
