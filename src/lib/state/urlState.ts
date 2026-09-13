/** Compact search params shared by the map and the viewfinder. Pure: no store access. */

import type { LngLat } from '@core/geo/geodesy';
import { Orientation } from '@core/optics/fov';

export interface SceneSearch {
  /** Camera location, `lat,lng`. */
  camera?: string;
  /** Target location, `lat,lng`. */
  target?: string;
  /** Map zoom. */
  z?: number;
  /** ISO instant, minute precision; absent while the clock is live. */
  t?: string;
  /** Time zone; absent while it follows the camera location. */
  tz?: string;
  /** Focal length, mm. */
  f?: number;
  /** `p` for portrait; absent for landscape. */
  o?: string;
}

const PORTRAIT = 'p';

const round = (n: number, digits: number) => Number(n.toFixed(digits));

export function formatPoint(p: LngLat): string {
  return `${round(p.lat, 5)},${round(p.lng, 5)}`;
}

/** Tolerant: junk, out-of-range values and wrong shapes give null instead of throwing. */
export function parsePoint(v: unknown): LngLat | null {
  if (typeof v !== 'string') return null;
  const parts = v.split(',');
  if (parts.length !== 2 || parts.some((s) => s.trim() === '')) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function formatInstant(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16)}Z`;
}

export function parseInstant(v: unknown): number | null {
  if (typeof v !== 'string' || !v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

export function parseNumber(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

export function parseText(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

/** Keeps only what parses; anything else is dropped silently. */
export function validateScene(raw: Record<string, unknown>): SceneSearch {
  return {
    camera: parsePoint(raw.camera) ? String(raw.camera) : undefined,
    target: parsePoint(raw.target) ? String(raw.target) : undefined,
    z: parseNumber(raw.z, 0, 24) ?? undefined,
    t: parseInstant(raw.t) != null ? String(raw.t) : undefined,
    tz: parseText(raw.tz),
    f: parseNumber(raw.f, 1, 10000) ?? undefined,
    o: raw.o === PORTRAIT ? PORTRAIT : undefined
  };
}

export interface SceneWorld {
  pin: LngLat;
  pin2: LngLat | null;
  time: number;
  live: boolean;
  tz: string;
  tzAuto: boolean;
}

function common(w: SceneWorld): SceneSearch {
  return {
    camera: formatPoint(w.pin),
    target: w.pin2 ? formatPoint(w.pin2) : undefined,
    t: w.live ? undefined : formatInstant(w.time),
    tz: w.tzAuto ? undefined : w.tz
  };
}

export function mapSearchFor(w: SceneWorld, zoom: number): SceneSearch {
  return { ...common(w), z: round(zoom, 2) };
}

export function viewfinderSearchFor(w: SceneWorld, c: { focalMm: number; orientation: Orientation }): SceneSearch {
  return { ...common(w), f: round(c.focalMm, 1), o: c.orientation === Orientation.Portrait ? PORTRAIT : undefined };
}

export function orientationFor(o: string | undefined): Orientation {
  return o === PORTRAIT ? Orientation.Portrait : Orientation.Landscape;
}
