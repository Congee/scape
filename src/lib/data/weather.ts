import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { LngLat } from '@core/geo/geodesy';
import { emptyBudget, rateLimited, refusal, spend, succeeded, type BudgetState } from '@core/weather/budget';
import { callWeight, forecastUrl, forecastWindow, parseForecast, roundCoord, windowDays, type DateWindow, type HourlyVar, type PointSeries } from '@core/weather/openMeteo';

/** Cached forecasts are refetched after this, and only when something asks. */
export const STALE_MS = 3_600_000;
const KEEP_MS = 3 * 86_400_000;
/** Open-Meteo accepts up to this many locations per request. */
const BATCH = 100;
const MEM_MAX = 4000;

export const ForecastStatus = {
  /** Fresh, or fetched within the hour. */
  Ok: 'Ok',
  /** Cached copy; the refetch could not happen (see note). */
  Cached: 'Cached',
  /** Nothing cached and nothing fetched (see note). */
  None: 'None',
  /** The API serves no forecast for this date. */
  OutOfRange: 'OutOfRange'
} as const;
export type ForecastStatus = (typeof ForecastStatus)[keyof typeof ForecastStatus];

export interface ForecastResult {
  status: ForecastStatus;
  series: PointSeries | null;
  fetchedAt: number;
  note: string;
}

interface Entry {
  key: string;
  fetchedAt: number;
  series: PointSeries;
}

interface MetaEntry {
  key: string;
  fetchedAt: number;
  runMs: number;
  /** When that run became downloadable; absent in records from before it was kept. */
  availMs?: number;
}

/** Everything one alpenglow forecast fetched for a point: the point, then samples toward the Sun. */
export interface GlowEntry {
  key: string;
  fetchedAt: number;
  window: DateWindow;
  bearings: number[];
  points: LngLat[];
  series: PointSeries[];
}

interface WeatherDB extends DBSchema {
  forecasts: { key: string; value: Entry; indexes: { byFetched: number } };
  meta: { key: string; value: MetaEntry };
  glow: { key: string; value: GlowEntry };
}

/** Request counters for the smoke tests and the budget readout. */
export const weatherStats = { requests: 0, weight: 0, refused: 0, errors: 0, lastUrl: '' };

let dbp: Promise<IDBPDatabase<WeatherDB> | null> | null = null;

// Kept apart from the exported `scape` database: this is a disposable cache.
export function db(): Promise<IDBPDatabase<WeatherDB> | null> {
  dbp ??= openDB<WeatherDB>('scape-weather', 2, {
    upgrade(d, from) {
      if (from < 1) {
        d.createObjectStore('forecasts', { keyPath: 'key' }).createIndex('byFetched', 'fetchedAt');
        d.createObjectStore('meta', { keyPath: 'key' });
      }
      if (from < 2) d.createObjectStore('glow', { keyPath: 'key' });
    }
  })
    .then(async (d) => {
      const old = await d.getAllKeysFromIndex('forecasts', 'byFetched', IDBKeyRange.upperBound(Date.now() - KEEP_MS));
      if (old.length) {
        const tx = d.transaction('forecasts', 'readwrite');
        for (const k of old) void tx.store.delete(k);
        await tx.done;
      }
      return d;
    })
    .catch(() => null);
  return dbp;
}

const BUDGET_KEY = 'scape.weatherBudget';
let budget: BudgetState = (() => {
  try {
    return { ...emptyBudget(), ...(JSON.parse(localStorage.getItem(BUDGET_KEY) ?? '{}') as Partial<BudgetState>) };
  } catch {
    return emptyBudget();
  }
})();
const saveBudget = (b: BudgetState) => {
  budget = b;
  try {
    localStorage.setItem(BUDGET_KEY, JSON.stringify(b));
  } catch {
    // Private mode: the budget still holds for this session.
  }
};
export const budgetState = () => budget;

const mem = new Map<string, Entry>();
const remember = (e: Entry) => {
  mem.delete(e.key);
  mem.set(e.key, e);
  if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value!);
};
const inflight = new Map<string, Promise<void>>();

const varsId = (vars: readonly HourlyVar[]) => vars.map((v) => v.replace(/[^a-z]/g, '').slice(0, 6)).join('.');
export const forecastKey = (p: LngLat, model: string, vars: readonly HourlyVar[], w: { startDate: string; endDate: string }) =>
  `${model}|${varsId(vars)}|${roundCoord(p.lat).toFixed(2)},${roundCoord(p.lng).toFixed(2)}|${w.startDate}/${w.endDate}`;

async function cached(keys: string[]): Promise<(Entry | undefined)[]> {
  const out: (Entry | undefined)[] = keys.map((k) => mem.get(k));
  const miss = keys.flatMap((k, i) => (out[i] ? [] : [i]));
  if (!miss.length) return out;
  const d = await db();
  if (!d) return out;
  const tx = d.transaction('forecasts');
  const got = await Promise.all(miss.map((i) => tx.store.get(keys[i])));
  miss.forEach((i, j) => {
    if (got[j]) remember((out[i] = got[j]));
  });
  return out;
}

/** One budgeted request; throws with a short note (offline, rate limited, the API's reason). */
export async function requestSeries(points: readonly LngLat[], model: string, vars: readonly HourlyVar[], w: DateWindow): Promise<PointSeries[]> {
  const weight = callWeight(points.length, vars.length, windowDays(w));
  const now = Date.now();
  const no = refusal(budget, now, weight);
  if (no) {
    weatherStats.refused++;
    throw new Error(no);
  }
  saveBudget(spend(budget, now, weight));
  const url = forecastUrl(points, model, vars, w);
  weatherStats.requests++;
  weatherStats.weight += weight;
  weatherStats.lastUrl = url;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    weatherStats.errors++;
    throw new Error('offline');
  }
  if (res.status === 429) {
    saveBudget(rateLimited(budget, Date.now()));
    throw new Error('rate limited by Open-Meteo');
  }
  let series: PointSeries[];
  try {
    series = parseForecast(await res.json(), vars);
  } catch (err) {
    weatherStats.errors++;
    throw new Error(err instanceof Error ? err.message : 'bad response', { cause: err });
  }
  if (!res.ok || series.length !== points.length) {
    weatherStats.errors++;
    throw new Error(`Open-Meteo ${res.status}`);
  }
  saveBudget(succeeded(budget));
  return series;
}

async function fetchBatch(points: LngLat[], keys: string[], model: string, vars: readonly HourlyVar[], w: DateWindow): Promise<string> {
  let series: PointSeries[];
  try {
    series = await requestSeries(points, model, vars, w);
  } catch (err) {
    return (err as Error).message;
  }
  const fetchedAt = Date.now();
  const entries = series.map((s, i): Entry => ({ key: keys[i], fetchedAt, series: s }));
  for (const e of entries) remember(e);
  const d = await db();
  if (d) {
    const tx = d.transaction('forecasts', 'readwrite');
    for (const e of entries) void tx.store.put(e);
    await tx.done.catch(() => undefined);
  }
  return '';
}

/**
 * Forecasts for `points` over the GMT dates covering [startMs, endMs), from cache when under an hour old,
 * else in batched requests within the budget. Never polls: callers ask when they need data.
 */
export async function forecastPoints(points: readonly LngLat[], model: string, vars: readonly HourlyVar[], startMs: number, endMs: number): Promise<ForecastResult[]> {
  const w = forecastWindow(startMs, endMs, Date.now());
  if (!w) return points.map(() => ({ status: ForecastStatus.OutOfRange, series: null, fetchedAt: 0, note: 'no forecast for this date' }));
  const keys = points.map((p) => forecastKey(p, model, vars, w));
  let have = await cached(keys);
  const now = Date.now();
  const need = new Map<string, LngLat>();
  const wait: Promise<void>[] = [];
  keys.forEach((k, i) => {
    const e = have[i];
    if (e && now - e.fetchedAt < STALE_MS) return;
    const running = inflight.get(k);
    if (running) wait.push(running);
    else need.set(k, { lat: roundCoord(points[i].lat), lng: roundCoord(points[i].lng) });
  });
  const notes = new Map<string, string>();
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const needKeys = [...need.keys()];
  for (let i = 0; i < needKeys.length; i += BATCH) {
    const ks = needKeys.slice(i, i + BATCH);
    const run = offline ? Promise.resolve('offline') : fetchBatch(ks.map((k) => need.get(k)!), ks, model, vars, w);
    const done = run.then((note) => {
      for (const k of ks) if (note) notes.set(k, note);
    });
    for (const k of ks) inflight.set(k, done);
    wait.push(done.finally(() => ks.forEach((k) => inflight.get(k) === done && inflight.delete(k))));
  }
  if (wait.length) {
    await Promise.all(wait);
    have = await cached(keys);
  }
  return keys.map((k, i) => {
    const e = have[i];
    const note = notes.get(k) ?? '';
    if (!e) return { status: ForecastStatus.None, series: null, fetchedAt: 0, note: note || 'no forecast' };
    return { status: Date.now() - e.fetchedAt < STALE_MS ? ForecastStatus.Ok : ForecastStatus.Cached, series: e.series, fetchedAt: e.fetchedAt, note };
  });
}

const metaMem = new Map<string, MetaEntry>();

export interface ModelRun {
  /** Start of the model's latest run and when it became available, epoch ms. */
  runMs: number;
  availMs: number | null;
  /** When this was read from Open-Meteo. */
  fetchedAt: number;
}

/** The model's latest run; null when unknown. Read at most hourly; an older record stands in offline. */
export async function modelRunInfo(metaId: string): Promise<ModelRun | null> {
  const key = metaId;
  let e = metaMem.get(key) ?? (await (await db())?.get('meta', key));
  if (e && Date.now() - e.fetchedAt < STALE_MS && e.availMs !== undefined) return { runMs: e.runMs, availMs: e.availMs, fetchedAt: e.fetchedAt };
  try {
    const res = await fetch(`https://api.open-meteo.com/data/${metaId}/static/meta.json`);
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as { last_run_initialisation_time?: number; last_run_availability_time?: number };
    if (typeof j.last_run_initialisation_time !== 'number') throw new Error('no run time');
    const avail = j.last_run_availability_time;
    e = { key, fetchedAt: Date.now(), runMs: j.last_run_initialisation_time * 1000, availMs: typeof avail === 'number' ? avail * 1000 : 0 };
    metaMem.set(key, e);
    await (await db())?.put('meta', e).catch(() => undefined);
  } catch {
    // Offline or unreported: an older record still says something.
  }
  return e ? { runMs: e.runMs, availMs: e.availMs || null, fetchedAt: e.fetchedAt } : null;
}

/** Start of the model's latest run, epoch ms; null when unknown. Cached for an hour. */
export async function modelRun(metaId: string): Promise<number | null> {
  return (await modelRunInfo(metaId))?.runMs ?? null;
}
