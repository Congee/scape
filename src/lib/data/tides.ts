import { parseStation, type TideStation, type TideStationRow } from '@core/tides/predict';

export interface TideStationRef {
  lat: number;
  lng: number;
  row: TideStationRow;
}

let pending: Promise<TideStationRef[]> | null = null;

/** Fetched once on first use and kept; a failed fetch rejects and is retried on the next call. */
export function tideStations(): Promise<TideStationRef[]> {
  pending ??= fetch('/tides/stations.json')
    .then((res) => {
      if (!res.ok) throw new Error(`tides ${res.status}`);
      return res.json() as Promise<{ stations: TideStationRow[] }>;
    })
    .then((d) => d.stations.map((row) => ({ lat: row[2], lng: row[3], row })))
    .catch((err: unknown) => {
      pending = null;
      throw err;
    });
  return pending;
}

const parsed = new WeakMap<TideStationRow, TideStation>();

export function tideStation(ref: TideStationRef): TideStation {
  let st = parsed.get(ref.row);
  if (!st) parsed.set(ref.row, (st = parseStation(ref.row)));
  return st;
}
