import type { LngLat } from '@core/geo/geodesy';
import { NEAREST_STATION_MAX_M, nearestStation, parseStation, tideCurve, tideExtremes, type TideExtreme, type TideStation, type TideStationRow } from '@core/tides/predict';
import { parseSubordinate, subordinateExtremes, type SubordinateRow, type SubordinateStation } from '@core/tides/subordinate';

export const TideKind = { Harmonic: 'Harmonic', Subordinate: 'Subordinate' } as const;
export type TideKind = (typeof TideKind)[keyof typeof TideKind];

export type TideStationRef = { lat: number; lng: number } & ({ kind: typeof TideKind.Harmonic; row: TideStationRow } | { kind: typeof TideKind.Subordinate; row: SubordinateRow });

/** A station ready to predict: harmonic, or subordinate with its parsed reference. */
export type TideSite = { kind: typeof TideKind.Harmonic; station: TideStation } | { kind: typeof TideKind.Subordinate; station: SubordinateStation; ref: TideStation };

async function load<T>(path: string): Promise<{ stations: T[] }> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`tides ${res.status}`);
  return res.json() as Promise<{ stations: T[] }>;
}

let pending: Promise<TideStationRef[]> | null = null;
const harmonicById = new Map<string, TideStationRow>();

/** Harmonic and subordinate stations, fetched once on first use and kept; a failed fetch rejects and is retried on the next call. */
export function tideStations(): Promise<TideStationRef[]> {
  pending ??= Promise.all([load<TideStationRow>('/tides/stations.json'), load<SubordinateRow>('/tides/subordinate.json')])
    .then(([h, s]) => {
      for (const row of h.stations) harmonicById.set(row[0], row);
      return [
        ...h.stations.map((row): TideStationRef => ({ kind: TideKind.Harmonic, lat: row[2], lng: row[3], row })),
        ...s.stations.filter((row) => harmonicById.has(row[4])).map((row): TideStationRef => ({ kind: TideKind.Subordinate, lat: row[2], lng: row[3], row }))
      ];
    })
    .catch((err: unknown) => {
      pending = null;
      throw err;
    });
  return pending;
}

/** The nearest harmonic station within `maxM`, else the nearest subordinate one: a harmonic prediction gives the whole curve. */
export function nearestTideStation(stations: readonly TideStationRef[], p: LngLat, maxM = NEAREST_STATION_MAX_M): { station: TideStationRef; distM: number } | null {
  return nearestStation(stations.filter((s) => s.kind === TideKind.Harmonic), p, maxM) ?? nearestStation(stations.filter((s) => s.kind === TideKind.Subordinate), p, maxM);
}

const parsed = new WeakMap<TideStationRow, TideStation>();
const harmonic = (row: TideStationRow) => {
  let st = parsed.get(row);
  if (!st) parsed.set(row, (st = parseStation(row)));
  return st;
};
const sites = new WeakMap<TideStationRef, TideSite>();

export function tideSite(ref: TideStationRef): TideSite {
  let site = sites.get(ref);
  if (site) return site;
  if (ref.kind === TideKind.Harmonic) site = { kind: TideKind.Harmonic, station: harmonic(ref.row) };
  else {
    const refRow = harmonicById.get(ref.row[4]);
    if (!refRow) throw new Error(`tide station ${ref.row[0]}: reference ${ref.row[4]} not loaded`);
    site = { kind: TideKind.Subordinate, station: parseSubordinate(ref.row), ref: harmonic(refRow) };
  }
  sites.set(ref, site);
  return site;
}

export interface TideDay {
  extremes: TideExtreme[];
  /** Heights every 10 min over the day; subordinate stations have highs and lows only. */
  curve: Float32Array | null;
}

// One local day per station; callers re-render every clock tick.
let dayCache: { site: TideSite; key: string; day: TideDay } | null = null;

export function tideDay(site: TideSite, startMs: number, endMs: number): TideDay {
  const key = `${startMs}|${endMs}`;
  if (dayCache?.site === site && dayCache.key === key) return dayCache.day;
  const day =
    site.kind === TideKind.Harmonic
      ? { extremes: tideExtremes(site.station, startMs, endMs), curve: tideCurve(site.station, startMs, endMs) }
      : { extremes: subordinateExtremes(site.station, site.ref, startMs, endMs), curve: null };
  dayCache = { site, key, day };
  return day;
}
