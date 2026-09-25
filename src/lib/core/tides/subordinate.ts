import { dropShortPairs, PAIR_MARGIN_MS, turningPoints, type TideExtreme, type TideStation } from './predict';

const FT = 0.3048;
const MIN_MS = 60_000;

export const HeightOffset = { Ratio: 'Ratio', AddFeet: 'AddFeet' } as const;
export type HeightOffset = (typeof HeightOffset)[keyof typeof HeightOffset];

/** A NOAA subordinate station: highs and lows are its reference station's, shifted and scaled. */
export interface SubordinateStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  refId: string;
  highMin: number;
  lowMin: number;
  highH: number;
  lowH: number;
  heightOffset: HeightOffset;
}

/** Bundled row: [id, name, lat, lng, reference id, high/low time offsets in minutes, high/low height offsets, 'R' ratio | 'F' feet added]. */
export type SubordinateRow = [string, string, number, number, string, number, number, number, number, string];

export function parseSubordinate(row: SubordinateRow): SubordinateStation {
  const [id, name, lat, lng, refId, highMin, lowMin, highH, lowH, kind] = row;
  if (kind !== 'R' && kind !== 'F') throw new Error(`tide station ${id}: unknown height offset ${kind}`);
  return { id, name, lat, lng, refId, highMin, lowMin, highH, lowH, heightOffset: kind === 'R' ? HeightOffset.Ratio : HeightOffset.AddFeet };
}

/** NOAA's subordinate method: each reference high/low moves by its time offset and takes its height offset; short pairs drop after the shift. */
export function subordinateExtremes(sub: SubordinateStation, ref: TideStation, fromMs: number, toMs: number): TideExtreme[] {
  const margin = Math.max(Math.abs(sub.highMin), Math.abs(sub.lowMin)) * MIN_MS + PAIR_MARGIN_MS;
  const shifted = turningPoints(ref, fromMs - margin, toMs + margin).map((e) => {
    const h = e.high ? sub.highH : sub.lowH;
    return { timeMs: e.timeMs + (e.high ? sub.highMin : sub.lowMin) * MIN_MS, heightM: sub.heightOffset === HeightOffset.Ratio ? e.heightM * h : e.heightM + h * FT, high: e.high };
  });
  // NOAA pairs in reference order; unequal offsets can swap a close pair in time.
  return dropShortPairs(shifted, fromMs, toMs).toSorted((a, b) => a.timeMs - b.timeMs);
}

/** Height and direction at `ms` on NOAA's cosine curve between the bracketing high and low (Tide Tables, Table 3); null outside them. */
export function cosineTide(extremes: readonly TideExtreme[], ms: number): { heightM: number; rising: boolean } | null {
  for (let i = 1; i < extremes.length; i++) {
    const a = extremes[i - 1];
    const b = extremes[i];
    if (ms > b.timeMs) continue;
    if (ms < a.timeMs) return null;
    const k = b.timeMs > a.timeMs ? (1 - Math.cos((Math.PI * (ms - a.timeMs)) / (b.timeMs - a.timeMs))) / 2 : 1;
    return { heightM: a.heightM + (b.heightM - a.heightM) * k, rising: b.heightM > a.heightM };
  }
  return null;
}

/** Heights every `stepMs` over [fromMs, toMs] on the cosine curve; `extremes` must bracket the span. */
export function cosineCurve(extremes: readonly TideExtreme[], fromMs: number, toMs: number, stepMs = 10 * MIN_MS): Float32Array {
  const n = Math.floor((toMs - fromMs) / stepMs) + 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = cosineTide(extremes, fromMs + i * stepMs);
    if (!t) throw new Error('cosineCurve: extremes do not bracket the span');
    out[i] = t.heightM;
  }
  return out;
}
