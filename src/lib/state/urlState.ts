/** Compact search params shared by the map and the viewfinder. Pure: no store access. */

import { formatDecimal, pixelDigits, textDigits } from '@core/geo/coords';
import { normalizeBearing, type LngLat } from '@core/geo/geodesy';
import { DEFAULT_SENSOR_ID, Orientation, SENSORS, Teleconverter, type SensorFormat } from '@core/optics/fov';
import type { AimLock } from './composition';

export interface SceneSearch {
  /** Camera location, `lat,lng`. A URL with it is a whole scene: its missing keys mean defaults. */
  c?: string;
  /** Camera height above ground, m. */
  ch?: number;
  /** Target location, `lat,lng`. */
  tg?: string;
  /** Target height above ground, m; a trailing `a` marks one the map read from a building. */
  th?: number | string;
  /** Map centre, `lat,lng`; absent while it sits on the camera. */
  m?: string;
  /** Map zoom. */
  z?: number;
  /** Map bearing, degrees. */
  b?: number;
  /** Map pitch, degrees. */
  pt?: number;
  /** Aim lock: `s` sun, `m` moon, `g` GC, `f` free; absent for the target. */
  a?: string;
  /** Aim azimuth and elevation, degrees; only when no lock sets them. */
  az?: number;
  el?: number;
  /** Base focal length, mm. */
  f?: number;
  /** `p` for portrait; absent for landscape. */
  o?: string;
  /** Mounted teleconverter factors, comma-separated (`1.4,2`); absent for none. */
  tc?: string | number;
  /** Sensor id; a custom body adds its size, `id:36x24`. */
  s?: string;
  /** ISO instant, minute precision; absent while the clock is live. */
  t?: string;
  /** Time zone; absent while it follows the camera location. */
  tz?: string;
  /** Camera and target of links made before the short keys; read only. */
  camera?: string;
  target?: string;
}

/** Everything a URL reproduces: the map viewport, the frame and the instant. */
export interface Scene {
  pin: LngLat;
  pinHeightM: number;
  pin2: LngLat | null;
  pin2HeightM: number;
  pin2HeightAuto: boolean;
  view: { center: LngLat; zoom: number; bearing: number; pitch: number };
  aimLock: AimLock;
  azimuthDeg: number;
  elevationDeg: number;
  focalMm: number;
  orientation: Orientation;
  teleconverters: readonly Teleconverter[];
  sensorId: string;
  /** Null while the clock is live. */
  time: number | null;
  /** Null while it follows the camera location. */
  tz: string | null;
}

export const DEFAULT_ZOOM = 11;
export const DEFAULT_FOCAL_MM = 35;

const PORTRAIT = 'p';
const AUTO = 'a';
const LOCK_CODES: Record<AimLock, string | undefined> = { Target: undefined, Sun: 's', Moon: 'm', Gc: 'g', Free: 'f' };
const lockFor = (code: unknown): AimLock => (Object.keys(LOCK_CODES) as AimLock[]).find((k) => LOCK_CODES[k] === code) ?? 'Target';

const isTeleconverter = (n: number | null): n is Teleconverter => n === Teleconverter.X14 || n === Teleconverter.X20;

/** Unknown factors are dropped, so a single `tc=2` from before stacking still reads as one converter. */
function teleconverterList(v: unknown): Teleconverter[] {
  const parts = typeof v === 'number' ? [v] : typeof v === 'string' ? v.split(',') : [];
  return parts.map((p) => parseNumber(p, 1, 2)).filter(isTeleconverter);
}

/** Missing or unknown means no teleconverter, so links made before the key still load. */
export function teleconvertersFor(tc: string | number | undefined): readonly Teleconverter[] {
  return teleconverterList(tc);
}

/** A lone factor stays a number, which the router would otherwise quote. */
function teleconverterText(list: readonly number[]): string | number | undefined {
  return list.length === 1 ? list[0] : list.join(',') || undefined;
}

const round = (n: number, digits: number) => Number(n.toFixed(digits));
/** Rounded, or undefined at the default so the common case stays out of the URL. */
const unlessDefault = (n: number, digits: number, def = 0) => {
  const r = round(n, digits);
  return r === def ? undefined : r;
};

/** At the point's known digits, so a link reads back with the same precision. */
export function formatPoint(p: LngLat): string {
  return formatDecimal(p);
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
  return { lat, lng, digits: { lat: textDigits(parts[0]), lng: textDigits(parts[1]) } };
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

const MAX_HEIGHT_M = 10_000;

function parseHeight(v: unknown): { m: number; auto: boolean } | null {
  const auto = typeof v === 'string' && v.endsWith(AUTO);
  const m = parseNumber(auto ? (v as string).slice(0, -1) : v, 0, MAX_HEIGHT_M);
  return m == null ? null : { m, auto };
}

const SENSOR_RE = /^([\w.:-]+?)(?::(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?))?$/;
/** A custom body the reader lacks falls back to a format this close in size. */
const SENSOR_MATCH_MM = 0.5;

function formatSensor(id: string, custom: readonly SensorFormat[]): string | undefined {
  if (id === DEFAULT_SENSOR_ID) return undefined;
  if (SENSORS.some((s) => s.id === id)) return id;
  const c = custom.find((s) => s.id === id);
  return c ? `${id}:${round(c.widthMm, 1)}x${round(c.heightMm, 1)}` : undefined;
}

function parseSensor(v: unknown, custom: readonly SensorFormat[]): string | null {
  const m = typeof v === 'string' ? SENSOR_RE.exec(v) : null;
  if (!m) return null;
  const all = [...SENSORS, ...custom];
  if (all.some((s) => s.id === m[1])) return m[1];
  if (m[2] == null) return null;
  const w = Number(m[2]);
  const h = Number(m[3]);
  return all.find((s) => Math.abs(s.widthMm - w) <= SENSOR_MATCH_MM && Math.abs(s.heightMm - h) <= SENSOR_MATCH_MM)?.id ?? null;
}

/** Keeps only what parses; anything else is dropped silently. */
export function validateScene(raw: Record<string, unknown>): SceneSearch {
  const point = (v: unknown) => (parsePoint(v) ? String(v) : undefined);
  const num = (v: unknown, min: number, max: number) => parseNumber(v, min, max) ?? undefined;
  const th = parseHeight(raw.th);
  return {
    c: point(raw.c),
    ch: num(raw.ch, -MAX_HEIGHT_M, MAX_HEIGHT_M),
    tg: point(raw.tg),
    th: th ? (th.auto ? `${th.m}${AUTO}` : th.m) : undefined,
    m: point(raw.m),
    z: num(raw.z, 0, 24),
    b: num(raw.b, -360, 360),
    pt: num(raw.pt, 0, 90),
    a: lockFor(raw.a) !== 'Target' ? String(raw.a) : undefined,
    az: num(raw.az, -360, 360),
    el: num(raw.el, -90, 90),
    f: num(raw.f, 1, 10000),
    o: raw.o === PORTRAIT ? PORTRAIT : undefined,
    tc: teleconverterText(teleconverterList(raw.tc)),
    s: typeof raw.s === 'string' && SENSOR_RE.test(raw.s) ? raw.s : undefined,
    t: parseInstant(raw.t) != null ? String(raw.t) : undefined,
    tz: parseText(raw.tz),
    camera: point(raw.camera),
    target: point(raw.target)
  };
}

/** True when no lock sets the angles: free, or a target lock with no target. */
export const aimIsFree = (s: Pick<Scene, 'aimLock' | 'pin2'>) => s.aimLock === 'Free' || (s.aimLock === 'Target' && !s.pin2);

/** The map centre at the digits that resolve one pixel at its zoom. */
function centreText(v: Scene['view']): string {
  const digits = pixelDigits(v.center.lat, v.zoom);
  const d = Math.max(digits.lat, digits.lng);
  return `${round(v.center.lat, d)},${round(v.center.lng, d)}`;
}

export function searchFor(s: Scene, customSensors: readonly SensorFormat[] = []): SceneSearch {
  const free = aimIsFree(s);
  return {
    c: formatPoint(s.pin),
    ch: unlessDefault(s.pinHeightM, 1),
    tg: s.pin2 ? formatPoint(s.pin2) : undefined,
    th: s.pin2 && s.pin2HeightM > 0 ? (s.pin2HeightAuto ? `${round(s.pin2HeightM, 1)}${AUTO}` : round(s.pin2HeightM, 1)) : undefined,
    m: centreText(s.view) === centreText({ ...s.view, center: s.pin }) ? undefined : centreText(s.view),
    z: unlessDefault(s.view.zoom, 2, DEFAULT_ZOOM),
    b: unlessDefault(s.view.bearing, 1),
    pt: unlessDefault(s.view.pitch, 1),
    a: LOCK_CODES[s.aimLock],
    az: free ? round(normalizeBearing(s.azimuthDeg), 1) % 360 : undefined,
    el: free ? round(s.elevationDeg, 1) : undefined,
    f: unlessDefault(s.focalMm, 1, DEFAULT_FOCAL_MM),
    o: s.orientation === Orientation.Portrait ? PORTRAIT : undefined,
    tc: teleconverterText(s.teleconverters),
    s: formatSensor(s.sensorId, customSensors),
    t: s.time == null ? undefined : formatInstant(s.time),
    tz: s.tz ?? undefined
  };
}

/** True when the search describes a whole scene rather than a few overrides. */
export const isWholeScene = (q: SceneSearch) => q.c != null;

/**
 * The scene a search describes. A whole scene takes defaults for its missing keys; otherwise
 * (an in-app visit, an old link) each missing key keeps `current`.
 */
export function stateFor(q: SceneSearch, current: Scene, customSensors: readonly SensorFormat[] = []): Scene {
  const whole = isWholeScene(q);
  const pick = <T>(v: T | null | undefined, def: T, cur: T): T => (v != null ? v : whole ? def : cur);
  const cameraText = q.c ?? q.camera;
  const pin = parsePoint(cameraText) ?? current.pin;
  const pin2Text = q.tg ?? q.target;
  const pin2 = pin2Text != null ? parsePoint(pin2Text) : whole ? null : current.pin2;
  const th = parseHeight(q.th);
  const keepHeight = !whole && pin2Text == null;
  // Old links centred the map on the camera too.
  const centre = parsePoint(q.m) ?? (cameraText != null ? pin : current.view.center);
  // Old viewfinder links always carried `f`, so with it a missing `o` or `tc` means the default too.
  const framed = whole || q.f != null;
  return {
    pin,
    pinHeightM: pick(q.ch, 0, current.pinHeightM),
    pin2,
    pin2HeightM: th?.m ?? (keepHeight ? current.pin2HeightM : 0),
    pin2HeightAuto: th?.auto ?? (keepHeight ? current.pin2HeightAuto : false),
    view: { center: centre, zoom: pick(q.z, DEFAULT_ZOOM, current.view.zoom), bearing: pick(q.b, 0, current.view.bearing), pitch: pick(q.pt, 0, current.view.pitch) },
    aimLock: q.a != null ? lockFor(q.a) : whole ? 'Target' : current.aimLock,
    azimuthDeg: q.az != null ? round(normalizeBearing(q.az), 6) : current.azimuthDeg,
    elevationDeg: q.el ?? current.elevationDeg,
    focalMm: pick(q.f, DEFAULT_FOCAL_MM, current.focalMm),
    orientation: q.o != null || framed ? orientationFor(q.o) : current.orientation,
    teleconverters: q.tc != null || framed ? teleconvertersFor(q.tc) : current.teleconverters,
    sensorId: (q.s != null ? parseSensor(q.s, customSensors) : null) ?? (whole ? DEFAULT_SENSOR_ID : current.sensorId),
    time: parseInstant(q.t) ?? (whole ? null : current.time),
    tz: q.tz ?? (whole ? null : current.tz)
  };
}

/** Entering the viewfinder faces the target again after a map drag freed the aim; a sky-body lock stays. */
export function retargeted(q: SceneSearch): SceneSearch {
  return q.a === LOCK_CODES.Free && q.tg ? { ...q, a: undefined, az: undefined, el: undefined } : q;
}

export function orientationFor(o: string | undefined): Orientation {
  return o === PORTRAIT ? Orientation.Portrait : Orientation.Landscape;
}
