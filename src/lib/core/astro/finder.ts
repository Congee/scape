import { SearchAltitude, type Observer } from 'astronomy-engine';
import { normalizeBearing } from '@core/geo/geodesy';
import { horizonAngleAt, type HorizonProfile } from '@core/terrain/horizon';
import { localParts } from '@core/time/localDay';
import { BODY, SkyBody } from './bodies';
import { moonInfo, position } from './positions';
import { RISE_APPARENT_DEG } from './refraction';

const D2R = Math.PI / 180;
const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
/** Sidereal rate, degrees per minute; azimuth outruns it only by 1 / cos(altitude). */
const RATE_DEG_MIN = 0.25;
/** Gap below which two passes are the same stay seen across a cut or a chunk edge. */
export const MERGE_GAP_MS = 1500;

/** Sun altitude conditions a moment must meet. */
export const SkyFilter = {
  Any: 'Any',
  Daylight: 'Daylight',
  GoldenHour: 'GoldenHour',
  BlueHour: 'BlueHour',
  SunDown: 'SunDown',
  CivilDark: 'CivilDark',
  NauticalDark: 'NauticalDark',
  AstroDark: 'AstroDark'
} as const;
export type SkyFilter = (typeof SkyFilter)[keyof typeof SkyFilter];

/** Sun altitude range each filter admits, degrees. */
export const SKY_RANGES: Record<SkyFilter, readonly [number, number]> = {
  Any: [-90, 90],
  Daylight: [RISE_APPARENT_DEG, 90],
  GoldenHour: [0, 6],
  BlueHour: [-8, -4],
  SunDown: [-90, RISE_APPARENT_DEG],
  CivilDark: [-90, -6],
  NauticalDark: [-90, -12],
  AstroDark: [-90, -18]
};

/** Declination each body can reach; band edges beyond its altitude reach are never searched. */
const DECLINATION: Record<SkyBody, readonly [number, number]> = { Sun: [-23.5, 23.5], Moon: [-29, 29], Gc: [-29.1, -28.9] };

export interface FinderQuery {
  body: SkyBody;
  /** Window running clockwise from `azFromDeg` to `azToDeg`; equal values mean any azimuth. */
  azFromDeg: number;
  azToDeg: number;
  altMinDeg: number;
  altMaxDeg: number;
  startMs: number;
  endMs: number;
  /** Time zone of the weekday filter. */
  tz: string;
  sky: SkyFilter;
  /** Moon illumination admitted at the moment, 0..1. */
  moonIllumMin: number;
  moonIllumMax: number;
  /** The moon must be below the horizon (ignored when the moon is the body). */
  moonDown: boolean;
  /** Local weekdays admitted, 0 = Sunday; null for any. */
  weekdays: number[] | null;
}

/** A search as the user states it; the query adds the resolved time range and zone. */
export interface FinderSettings {
  body: SkyBody;
  azFromDeg: number;
  azToDeg: number;
  altMinDeg: number;
  altMaxDeg: number;
  /** First local day of the search, "YYYY-MM-DD". */
  startIso: string;
  days: number;
  sky: SkyFilter;
  moonIllumMin: number;
  moonIllumMax: number;
  moonDown: boolean;
  weekdays: number[] | null;
  /** Require the body to stand above the terrain skyline. */
  aboveTerrain: boolean;
  /** Half-width of a window taken from the target or the frame, degrees. */
  toleranceDeg: number;
}

/** One stay of the body inside the window. */
export interface Pass {
  startMs: number;
  endMs: number;
}

export interface FinderHit extends Pass {
  /** Moment nearest the window centre. */
  bestMs: number;
  azDeg: number;
  altDeg: number;
  sunAltDeg: number;
  moonAltDeg: number;
  moonIllumination: number;
  moonPhase: string;
  /** The pass runs into the search range boundary. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

export function inAzWindow(azDeg: number, fromDeg: number, toDeg: number): boolean {
  if (fromDeg === toDeg) return true;
  return normalizeBearing(azDeg - fromDeg) <= normalizeBearing(toDeg - fromDeg);
}

/** Angular distance from an azimuth to the window, 0 inside. */
export function azDistanceDeg(azDeg: number, fromDeg: number, toDeg: number): number {
  if (inAzWindow(azDeg, fromDeg, toDeg)) return 0;
  return Math.min(normalizeBearing(fromDeg - azDeg), normalizeBearing(azDeg - toDeg));
}

/** Distance from an azimuth inside the window to its nearer edge. */
function azMarginDeg(azDeg: number, fromDeg: number, toDeg: number): number {
  if (fromDeg === toDeg) return 180;
  return Math.min(normalizeBearing(azDeg - fromDeg), normalizeBearing(toDeg - azDeg));
}

/** Altitude range the body can reach from this latitude, a degree of slack included. */
function reach(body: SkyBody, latDeg: number): [number, number] {
  const [lo, hi] = DECLINATION[body];
  const dist = (x: number) => (x < lo ? lo - x : x > hi ? x - hi : 0);
  return [dist(-latDeg) - 91, 91 - dist(latDeg)];
}

/** SearchAltitude ignores refraction while `position` applies it; move the hit onto the refracted crossing. */
function refineCrossing(body: SkyBody, obs: Observer, altDeg: number, ms: number, startMs: number, endMs: number): number {
  const f = (t: number) => position(body, new Date(t), obs).altitude - altDeg;
  let lo = Math.max(startMs, ms - 15 * MIN_MS);
  let hi = Math.min(endMs, ms + 15 * MIN_MS);
  const fLo = f(lo);
  if (fLo * f(hi) > 0) return ms;
  for (let k = 0; k < 22; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) * fLo > 0) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

function crossings(body: SkyBody, obs: Observer, dir: 1 | -1, altDeg: number, startMs: number, endMs: number): number[] {
  const out: number[] = [];
  let from = startMs;
  while (from < endMs) {
    const t = SearchAltitude(BODY[body], obs, dir, new Date(from), (endMs - from) / DAY_MS + 1 / 1440, altDeg);
    if (!t) break;
    const ms = t.date.getTime();
    if (ms >= endMs) break;
    out.push(refineCrossing(body, obs, altDeg, ms, startMs, endMs));
    from = ms + MIN_MS;
  }
  return out;
}

/** Spans within [startMs, endMs) during which the body's altitude stays inside the band. */
export function altitudeBands(body: SkyBody, obs: Observer, altMinDeg: number, altMaxDeg: number, startMs: number, endMs: number): Pass[] {
  const [lo, hi] = reach(body, obs.latitude);
  if (altMinDeg > altMaxDeg || altMinDeg > hi || altMaxDeg < lo) return [];
  const cuts = [startMs, endMs];
  for (const alt of [altMinDeg, altMaxDeg]) {
    if (alt < lo || alt > hi) continue;
    for (const dir of [1, -1] as const) cuts.push(...crossings(body, obs, dir, alt, startMs, endMs));
  }
  cuts.sort((a, b) => a - b);
  const out: Pass[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (b - a < 1000) continue;
    const alt = position(body, new Date((a + b) / 2), obs).altitude;
    if (alt < altMinDeg || alt > altMaxDeg) continue;
    const last = out.at(-1);
    if (last && last.endMs >= a) last.endMs = b;
    else out.push({ startMs: a, endMs: b });
  }
  return out;
}

/**
 * Every stay of the body inside the window over the query range, in order.
 * Altitude bands come from exact crossing searches; inside a band the azimuth is stepped
 * no further than it could move at the sidereal rate, so no pass can be skipped.
 */
export function findPasses(q: FinderQuery, obs: Observer, horizon?: HorizonProfile): Pass[] {
  const inside = (ms: number) => {
    const p = position(q.body, new Date(ms), obs);
    return inAzWindow(p.azimuth, q.azFromDeg, q.azToDeg) && p.altitude >= q.altMinDeg - 1e-6 && p.altitude <= q.altMaxDeg + 1e-6 && (!horizon || p.altitude >= horizonAngleAt(horizon, p.azimuth));
  };
  const bisect = (lo: number, hi: number, loIn: boolean) => {
    for (let k = 0; k < 22; k++) {
      const mid = (lo + hi) / 2;
      if (inside(mid) === loIn) lo = mid;
      else hi = mid;
    }
    return Math.round((lo + hi) / 2);
  };
  const out: Pass[] = [];
  for (const band of altitudeBands(q.body, obs, q.altMinDeg, q.altMaxDeg, q.startMs, q.endMs)) {
    let t = band.startMs;
    let prevT = t;
    let prevIn = false;
    for (;;) {
      const p = position(q.body, new Date(t), obs);
      const inAz = inAzWindow(p.azimuth, q.azFromDeg, q.azToDeg);
      const nowIn = inAz && p.altitude >= q.altMinDeg - 1e-6 && p.altitude <= q.altMaxDeg + 1e-6 && (!horizon || p.altitude >= horizonAngleAt(horizon, p.azimuth));
      if (nowIn !== prevIn) {
        const at = prevT === t ? t : bisect(prevT, t, prevIn);
        if (nowIn) out.push({ startMs: at, endMs: at });
        else out[out.length - 1].endMs = at;
      }
      if (t >= band.endMs) {
        if (nowIn) out[out.length - 1].endMs = band.endMs;
        break;
      }
      const rate = RATE_DEG_MIN / Math.cos(Math.min(88, Math.abs(p.altitude) + 2) * D2R);
      const stepMin = inAz
        ? clamp((0.9 * azMarginDeg(p.azimuth, q.azFromDeg, q.azToDeg)) / rate, 0.5, horizon ? 5 : 15)
        : clamp((azDistanceDeg(p.azimuth, q.azFromDeg, q.azToDeg) - 0.1) / rate, 0.25, 60);
      prevT = t;
      prevIn = nowIn;
      t = Math.min(band.endMs, t + stepMin * MIN_MS);
    }
  }
  return mergePasses(out);
}

/** Passes split only by a band cut or a chunk boundary are one pass. */
export function mergePasses(passes: Pass[]): Pass[] {
  const merged: Pass[] = [];
  for (const p of passes) {
    const last = merged.at(-1);
    if (last && p.startMs - last.endMs <= MERGE_GAP_MS) last.endMs = p.endMs;
    else merged.push({ ...p });
  }
  return merged;
}

/** The pass with its best moment (nearest the window centre) and the sky around it. */
export function describePass(q: FinderQuery, obs: Observer, pass: Pass): FinderHit {
  const anyAz = q.azFromDeg === q.azToDeg;
  const azC = normalizeBearing(q.azFromDeg + normalizeBearing(q.azToDeg - q.azFromDeg) / 2);
  const altC = (q.altMinDeg + q.altMaxDeg) / 2;
  const score = (ms: number) => {
    const p = position(q.body, new Date(ms), obs);
    return Math.hypot(anyAz ? 0 : angleDiff(p.azimuth, azC) * Math.cos(p.altitude * D2R), p.altitude - altC);
  };
  const n = 24;
  const span = pass.endMs - pass.startMs;
  let bestI = 0;
  let bestS = Infinity;
  for (let i = 0; i <= n; i++) {
    const s = score(pass.startMs + (span * i) / n);
    if (s < bestS) {
      bestS = s;
      bestI = i;
    }
  }
  let lo = pass.startMs + (span * Math.max(0, bestI - 1)) / n;
  let hi = pass.startMs + (span * Math.min(n, bestI + 1)) / n;
  const g = (Math.sqrt(5) - 1) / 2;
  let a = hi - g * (hi - lo);
  let b = lo + g * (hi - lo);
  let fa = score(a);
  let fb = score(b);
  for (let k = 0; k < 18 && hi - lo > 1000; k++) {
    if (fa < fb) {
      hi = b;
      b = a;
      fb = fa;
      a = hi - g * (hi - lo);
      fa = score(a);
    } else {
      lo = a;
      a = b;
      fa = fb;
      b = lo + g * (hi - lo);
      fb = score(b);
    }
  }
  const bestMs = Math.round((lo + hi) / 2);
  const d = new Date(bestMs);
  const p = position(q.body, d, obs);
  const mi = moonInfo(d);
  return {
    ...pass,
    bestMs,
    azDeg: p.azimuth,
    altDeg: p.altitude,
    sunAltDeg: position(SkyBody.Sun, d, obs).altitude,
    moonAltDeg: position(SkyBody.Moon, d, obs).altitude,
    moonIllumination: mi.illumination,
    moonPhase: mi.name,
    clippedStart: pass.startMs <= q.startMs,
    clippedEnd: pass.endMs >= q.endMs
  };
}

/** Sky, moon and weekday filters; the sky condition may hold anywhere in the pass. */
export function passesFilters(h: FinderHit, q: FinderQuery, obs: Observer): boolean {
  if (q.sky !== SkyFilter.Any) {
    const [lo, hi] = SKY_RANGES[q.sky];
    const sunOk = (alt: number) => alt >= lo && alt <= hi;
    if (!sunOk(h.sunAltDeg) && !sunOk(position(SkyBody.Sun, new Date(h.startMs), obs).altitude) && !sunOk(position(SkyBody.Sun, new Date(h.endMs), obs).altitude)) return false;
  }
  if (h.moonIllumination < q.moonIllumMin - 1e-9 || h.moonIllumination > q.moonIllumMax + 1e-9) return false;
  if (q.moonDown && q.body !== SkyBody.Moon && h.moonAltDeg >= 0) return false;
  if (q.weekdays && q.weekdays.length < 7) {
    const p = localParts(new Date(h.bestMs), q.tz);
    if (!q.weekdays.includes(new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay())) return false;
  }
  return true;
}
