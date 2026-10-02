/** Geographic bounding boxes in degrees, with antimeridian-crossing support. */

import { normalizeLng } from './geodesy';
import type { Digits, LngLat } from './geodesy';

/** `west > east` means the box crosses the antimeridian. */
export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
  /** Precision of the corners, when known. */
  digits?: Digits;
}

/** Keeps an exact ±180 as given, so an east edge on the antimeridian survives. */
const wrapLng = (lng: number) => (lng >= -180 && lng <= 180 ? lng : normalizeLng(lng));

/** Non-crossing box through the two corners; build a crossing box by setting `west > east`. */
export function bboxFromCorners(a: LngLat, b: LngLat): Bbox {
  const aLng = wrapLng(a.lng);
  const bLng = wrapLng(b.lng);
  return {
    west: Math.min(aLng, bLng),
    south: Math.min(a.lat, b.lat),
    east: Math.max(aLng, bLng),
    north: Math.max(a.lat, b.lat),
    ...(a.digits && b.digits ? { digits: { lat: Math.max(a.digits.lat, b.digits.lat), lng: Math.max(a.digits.lng, b.digits.lng) } } : {})
  };
}

/** Longitude spans of a box as one or two non-crossing [lo, hi] intervals. */
const lngSpans = (b: Bbox): Array<[number, number]> => (b.west <= b.east ? [[b.west, b.east]] : [[b.west, 180], [-180, b.east]]);

export function bboxContains(b: Bbox, p: LngLat): boolean {
  if (p.lat < b.south || p.lat > b.north) return false;
  const lng = wrapLng(p.lng);
  // +360 also lets a point at -180 match a span ending at +180.
  return lngSpans(b).some(([lo, hi]) => (lng >= lo && lng <= hi) || (lng + 360 >= lo && lng + 360 <= hi));
}

export function bboxIntersects(a: Bbox, b: Bbox): boolean {
  if (a.north < b.south || b.north < a.south) return false;
  return lngSpans(a).some(([lo, hi]) => lngSpans(b).some(([lo2, hi2]) => lo <= hi2 && lo2 <= hi));
}

export function bboxCentre(b: Bbox): LngLat {
  const width = b.west <= b.east ? b.east - b.west : b.east + 360 - b.west;
  return { lng: normalizeLng(b.west + width / 2), lat: (b.south + b.north) / 2, ...(b.digits ? { digits: b.digits } : {}) };
}

/** How many different boxes the list holds; precision is ignored. */
export const distinctBboxes = (bs: readonly Bbox[]): number => new Set(bs.map((b) => `${b.west},${b.south},${b.east},${b.north}`)).size;
