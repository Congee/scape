import { distanceM, type LngLat } from '@core/geo/geodesy';
import { CONSTITUENT_NAMES, CONSTITUENTS, type Constituent, type NodeArgs } from './constituents';

/** A harmonic station: heights come out in metres above MLLW. */
export interface TideStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Mean sea level above MLLW, metres. */
  z0M: number;
  constituents: { c: Constituent; ampM: number; phaseDeg: number }[];
}

/** Bundled row: [id, name, lat, lng, z0 mm, flat (index, amplitude mm, phase_GMT × 10) triples]. */
export type TideStationRow = [string, string, number, number, number, number[]];

export function parseStation(row: TideStationRow): TideStation {
  const [id, name, lat, lng, z0Mm, flat] = row;
  const constituents = [];
  for (let i = 0; i < flat.length; i += 3) {
    constituents.push({ c: CONSTITUENTS[CONSTITUENT_NAMES[flat[i]]], ampM: flat[i + 1] / 1000, phaseDeg: flat[i + 2] / 10 });
  }
  return { id, name, lat, lng, z0M: z0Mm / 1000, constituents };
}

const D = Math.PI / 180;
const J2000_MS = Date.UTC(2000, 0, 1, 12);
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
// ω and i of Schureman's node formulas.
const OMEGA = 23.452 * D;
const INCL = 5.145 * D;

const centuries = (ms: number) => (ms - J2000_MS) / DAY_MS / 36525;
const PER_HOUR = 1 / (36525 * 24);
const RATES = [15, 481267.88123421 * PER_HOUR, 36000.76983 * PER_HOUR, 4069.0137287 * PER_HOUR, 1.7192 * PER_HOUR];

/** Mean astronomical arguments T, s, h, p, p1, degrees; their rates per hour are `RATES`. */
function astroArgs(ms: number): number[] {
  const c = centuries(ms);
  return [(360 * (ms - J2000_MS)) / DAY_MS, 218.3164477 + 481267.88123421 * c, 280.46646 + 36000.76983 * c, 83.3532465 + 4069.0137287 * c, 282.94 + 1.7192 * c];
}

const nodeCache = new Map<number, NodeArgs>();

/** Node quantities held fixed over each UTC year at their mid-year value, as NOAA does. */
function nodeArgs(ms: number): NodeArgs {
  const year = new Date(ms).getUTCFullYear();
  const hit = nodeCache.get(year);
  if (hit) return hit;
  const c = centuries(Date.UTC(year, 6, 2));
  const N = (125.04452 - 1934.136261 * c) * D;
  const p = 83.3532465 + 4069.0137287 * c;
  const I = Math.acos(Math.cos(OMEGA) * Math.cos(INCL) - Math.sin(OMEGA) * Math.sin(INCL) * Math.cos(N));
  const t = Math.tan(N / 2);
  const e1 = Math.atan((t * Math.cos((OMEGA - INCL) / 2)) / Math.cos((OMEGA + INCL) / 2)) - N / 2;
  const e2 = Math.atan((t * Math.sin((OMEGA - INCL) / 2)) / Math.sin((OMEGA + INCL) / 2)) - N / 2;
  const xi = -(e1 + e2) / D;
  const nu = (e1 - e2) / D;
  const s2I = Math.sin(2 * I);
  const sI2 = Math.sin(I) ** 2;
  const nuR = nu * D;
  const nuP = Math.atan2(s2I * Math.sin(nuR), s2I * Math.cos(nuR) + 0.3347) / D;
  const nu2PP = Math.atan2(sI2 * Math.sin(2 * nuR), sI2 * Math.cos(2 * nuR) + 0.0727) / D;
  const node = { I, xi, nu, nuP, nu2PP, P: p - xi };
  nodeCache.set(year, node);
  return node;
}

function sum(st: TideStation, ms: number, derivative: boolean): number {
  const args = astroArgs(ms);
  const node = nodeArgs(ms);
  let out = derivative ? 0 : st.z0M;
  for (const { c, ampM, phaseDeg } of st.constituents) {
    const [f, u] = c.nodal(node);
    let arg = c.v[5] + u - phaseDeg;
    let speed = 0;
    for (let k = 0; k < 5; k++) {
      arg += c.v[k] * args[k];
      speed += c.v[k] * RATES[k];
    }
    out += derivative ? -f * ampM * speed * D * Math.sin(arg * D) : f * ampM * Math.cos(arg * D);
  }
  return out;
}

/** Predicted tide height above MLLW, metres. */
export function tideHeight(st: TideStation, ms: number): number {
  return sum(st, ms, false);
}

/** Rate of rise, metres per hour; nodal drift is left out as negligible. */
export function tideRate(st: TideStation, ms: number): number {
  return sum(st, ms, true);
}

export interface TideExtreme {
  timeMs: number;
  heightM: number;
  high: boolean;
}

const SCAN_MS = 10 * 60_000;

/** Highs and lows with `fromMs <= time < toMs`, from sign changes of the rate refined by bisection. */
export function tideExtremes(st: TideStation, fromMs: number, toMs: number): TideExtreme[] {
  const out: TideExtreme[] = [];
  let t0 = fromMs;
  let r0 = tideRate(st, t0);
  while (t0 < toMs) {
    const t1 = Math.min(t0 + SCAN_MS, toMs);
    const r1 = tideRate(st, t1);
    if (r0 > 0 !== r1 > 0) {
      let lo = t0;
      let hi = t1;
      while (hi - lo > 1000) {
        const mid = (lo + hi) / 2;
        if (tideRate(st, mid) > 0 === r0 > 0) lo = mid;
        else hi = mid;
      }
      const timeMs = Math.round((lo + hi) / 2);
      if (timeMs >= fromMs && timeMs < toMs) out.push({ timeMs, heightM: tideHeight(st, timeMs), high: r0 > 0 });
    }
    t0 = t1;
    r0 = r1;
  }
  return out;
}

/** Heights sampled every `stepMs` over [fromMs, toMs]. */
export function tideCurve(st: TideStation, fromMs: number, toMs: number, stepMs = HOUR_MS / 6): Float32Array {
  const n = Math.floor((toMs - fromMs) / stepMs) + 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = tideHeight(st, fromMs + i * stepMs);
  return out;
}

export const NEAREST_STATION_MAX_M = 50_000;

/** Closest station within `maxM` of `p`, or null. */
export function nearestStation<S extends { lat: number; lng: number }>(stations: readonly S[], p: LngLat, maxM = NEAREST_STATION_MAX_M): { station: S; distM: number } | null {
  let best: { station: S; distM: number } | null = null;
  for (const s of stations) {
    // Cheap latitude reject before the geodesic.
    if (Math.abs(s.lat - p.lat) * 111_000 > maxM) continue;
    const d = distanceM(p, { lat: s.lat, lng: s.lng });
    if (d <= maxM && (!best || d < best.distM)) best = { station: s, distM: d };
  }
  return best;
}
