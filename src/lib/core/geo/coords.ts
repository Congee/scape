import type { LngLat } from './geodesy';

// Values are persisted in settings.
export const CoordFormat = { DD: 'dd', DM: 'dm', DMS: 'dms' } as const;
export type CoordFormat = (typeof CoordFormat)[keyof typeof CoordFormat];

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

function fmtOne(value: number, pos: string, neg: string, format: CoordFormat): string {
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

export function formatLngLat(p: LngLat, format: CoordFormat = CoordFormat.DD): string {
  return `${fmtOne(p.lat, 'N', 'S', format)} ${fmtOne(p.lng, 'E', 'W', format)}`;
}

/** Decimal degrees with sign, suitable for pasting into other tools. */
export function formatDecimal(p: LngLat, digits = 5): string {
  return `${p.lat.toFixed(digits)}, ${p.lng.toFixed(digits)}`;
}

const NUM = String.raw`(-?\d+(?:\.\d+)?)`;
const SEP = String.raw`[°:\s]*`;
// One coordinate in D, D M, or D M S form with optional hemisphere letter on either side.
const ONE = String.raw`([NSEW])?\s*${NUM}${SEP}(?:(\d+(?:\.\d+)?)['′:\s]*)?(?:(\d+(?:\.\d+)?)["″]?)?\s*([NSEW])?`;
const PAIR = new RegExp(String.raw`^\s*${ONE}\s*[,;/\s]\s*${ONE}\s*$`, 'i');

/**
 * Parse "40.7463, -74.1553", "40°44'46.7\"N 74°09'19.1\"W", "N40 44.78 W74 09.32" and similar.
 * Returns null when the text is not a coordinate pair.
 */
export function parseLngLat(text: string): LngLat | null {
  const m = PAIR.exec(text.replace(/[−–]/g, '-'));
  if (!m) return null;
  const a = toDeg(m[1], m[2], m[3], m[4], m[5]);
  const b = toDeg(m[6], m[7], m[8], m[9], m[10]);
  if (a === null || b === null) return null;
  // Decide which is latitude: hemisphere letters win, else assume "lat, lng".
  let lat: number, lng: number;
  if (a.axis === 'lng' || b.axis === 'lat') {
    lng = a.value;
    lat = b.value;
  } else {
    lat = a.value;
    lng = b.value;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function toDeg(
  pre: string | undefined,
  d: string,
  m: string | undefined,
  s: string | undefined,
  post: string | undefined
): { value: number; axis: 'lat' | 'lng' | null } | null {
  const hemi = (pre || post || '').toUpperCase();
  if (pre && post) return null;
  const deg = parseFloat(d);
  if (Number.isNaN(deg)) return null;
  let value = Math.abs(deg) + (m ? parseFloat(m) / 60 : 0) + (s ? parseFloat(s) / 3600 : 0);
  if ((m || s) && (parseFloat(m ?? '0') >= 60 || parseFloat(s ?? '0') >= 60)) return null;
  const negative = deg < 0 || d.startsWith('-') || hemi === 'S' || hemi === 'W';
  if (negative) value = -value;
  const axis = hemi === 'N' || hemi === 'S' ? 'lat' : hemi === 'E' || hemi === 'W' ? 'lng' : null;
  return { value, axis };
}
