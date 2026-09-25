import { EARTH_RADIUS_M, geodesicLine, type LngLat } from '@core/geo/geodesy';
import { HourlyVar, valueAt, type PointSeries } from './openMeteo';

/** Typical cloud-layer heights, metres: low tops out near 2 km, mid spans 2–6 km, high sits above. */
export const CLOUD_HEIGHT_M = { low: 1000, mid: 4000, high: 8000 } as const;

/** Sample distances along the sightline, km; 0 is overhead. */
export const SIGHT_KM = [0, 10, 25, 50, 80, 110, 160, 220, 320] as const;

/** Ground distance at which a cloud at height `h` sits on the horizon: sqrt(2Rh). */
export const reachM = (h: number) => Math.sqrt(2 * EARTH_RADIUS_M * h);

export const SightVerdict = { Clear: 'Clear', Partial: 'Partial', Blocked: 'Blocked', Unknown: 'Unknown' } as const;
export type SightVerdict = (typeof SightVerdict)[keyof typeof SightVerdict];

/** Horizon cover below this is called clear, at or above BLOCKED blocked. */
export const CLEAR_PCT = 25;
export const BLOCKED_PCT = 70;

export interface SightSample {
  km: number;
  low: number;
  mid: number;
  high: number;
}

export interface Sightline {
  samples: SightSample[];
  /** Mean low/mid cover along the path within each layer's reach, NaN when no sample has a value. */
  blockLow: number;
  blockMid: number;
  /** Overhead mid/high cover: what the light paints. */
  canvasMid: number;
  canvasHigh: number;
  verdict: SightVerdict;
}

/** Points along the geodesic from `from` towards `bearing`, one per SIGHT_KM. */
export function sightPoints(from: LngLat, bearing: number): LngLat[] {
  const at = geodesicLine(from, bearing);
  return SIGHT_KM.map((km) => (km === 0 ? { lat: from.lat, lng: from.lng } : at(km * 1000)));
}

const mean = (xs: number[]) => {
  const ok = xs.filter((x) => !Number.isNaN(x));
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : NaN;
};

/** Blocking and canvas from samples ordered as SIGHT_KM. */
export function summarise(samples: SightSample[]): Sightline {
  const along = samples.filter((s) => s.km > 0);
  const blockLow = mean(along.filter((s) => s.km * 1000 <= reachM(CLOUD_HEIGHT_M.low)).map((s) => s.low));
  const blockMid = mean(along.filter((s) => s.km * 1000 <= reachM(CLOUD_HEIGHT_M.mid)).map((s) => s.mid));
  const top = samples.find((s) => s.km === 0);
  const worst = Math.max(Number.isNaN(blockLow) ? -1 : blockLow, Number.isNaN(blockMid) ? -1 : blockMid);
  const verdict = Number.isNaN(blockLow) || Number.isNaN(blockMid) ? SightVerdict.Unknown : worst >= BLOCKED_PCT ? SightVerdict.Blocked : worst < CLEAR_PCT ? SightVerdict.Clear : SightVerdict.Partial;
  return { samples, blockLow, blockMid, canvasMid: top?.mid ?? NaN, canvasHigh: top?.high ?? NaN, verdict };
}

/** Samples at `ms` from series ordered as SIGHT_KM; a missing series reads as unknown. */
export function sightSamples(series: readonly (PointSeries | null)[], ms: number): SightSample[] {
  return SIGHT_KM.map((km, i) => {
    const s = series[i];
    const v = (k: HourlyVar) => (s ? valueAt(s, k, ms) : NaN);
    return { km, low: v(HourlyVar.CloudLow), mid: v(HourlyVar.CloudMid), high: v(HourlyVar.CloudHigh) };
  });
}
