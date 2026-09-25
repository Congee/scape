import type { LngLat } from '@core/geo/geodesy';
import { AZ_BIN_DEG, glowPoints } from '@core/weather/alpenglow';
import { modelInfo } from '@core/weather/models';
import { CLOUD_VARS, roundCoord, type DateWindow, type PointSeries } from '@core/weather/openMeteo';
import { db, modelRunInfo, requestSeries, STALE_MS, type GlowEntry } from './weather';

export const GlowStatus = {
  /** Fetched now, or cached from the model's latest run. */
  Ok: 'Ok',
  /** An older copy; the refetch failed or could not happen (see note). */
  Cached: 'Cached',
  /** Nothing downloaded (see note). */
  None: 'None'
} as const;
export type GlowStatus = (typeof GlowStatus)[keyof typeof GlowStatus];

export interface GlowForecast {
  status: GlowStatus;
  entry: GlowEntry | null;
  note: string;
}

/** Counters for the smoke test. */
export const glowStats = { fetches: 0, cacheHits: 0 };

const mem = new Map<string, GlowEntry>();
const inflight = new Map<string, Promise<GlowForecast>>();

export const glowKey = (model: string, p: LngLat) => `${model}|${roundCoord(p.lat).toFixed(2)},${roundCoord(p.lng).toFixed(2)}`;

const angleGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** The entry has the dates and a sample line within one bin of every bearing. */
export const covers = (e: GlowEntry, w: DateWindow, bearings: readonly number[]) =>
  e.window.startDate <= w.startDate && e.window.endDate >= w.endDate && bearings.every((b) => e.bearings.some((c) => angleGap(b, c) <= AZ_BIN_DEG));

/** Current until the model's next run is out; blends, which report no run, for an hour. */
async function current(e: GlowEntry, model: string): Promise<boolean> {
  const metaId = modelInfo(model).metaId;
  if (!metaId) return Date.now() - e.fetchedAt < STALE_MS;
  const run = await modelRunInfo(metaId);
  if (!run?.availMs) return Date.now() - e.fetchedAt < STALE_MS;
  return e.fetchedAt >= run.availMs;
}

async function load(key: string): Promise<GlowEntry | null> {
  const hit = mem.get(key);
  if (hit) return hit;
  const e = (await (await db())?.get('glow', key)) ?? null;
  if (e) mem.set(key, e);
  return e;
}

async function refresh(key: string, point: LngLat, model: string, bearings: readonly number[], w: DateWindow): Promise<GlowForecast> {
  const old = await load(key);
  if (old && covers(old, w, bearings) && (await current(old, model))) {
    glowStats.cacheHits++;
    return { status: GlowStatus.Ok, entry: old, note: '' };
  }
  const stale = (note: string): GlowForecast => ({ status: old ? GlowStatus.Cached : GlowStatus.None, entry: old, note });
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return stale('offline');
  const at = { lat: roundCoord(point.lat), lng: roundCoord(point.lng) };
  const points = glowPoints(at, bearings);
  glowStats.fetches++;
  let series: PointSeries[];
  try {
    series = await requestSeries(points, model, CLOUD_VARS, w);
  } catch (err) {
    return stale((err as Error).message);
  }
  const entry: GlowEntry = { key, fetchedAt: Date.now(), window: w, bearings: [...bearings], points, series };
  mem.set(key, entry);
  await (await db())?.put('glow', entry).catch(() => undefined);
  return { status: GlowStatus.Ok, entry, note: '' };
}

/** Cloud along each Sun bearing for the dates in `w`: one request, reused until the model's next run. */
export function glowForecast(point: LngLat, model: string, bearings: readonly number[], w: DateWindow): Promise<GlowForecast> {
  const key = glowKey(model, point);
  const id = `${key}|${w.startDate}/${w.endDate}|${bearings.join(',')}`;
  let p = inflight.get(id);
  if (!p) {
    p = refresh(key, point, model, bearings, w).finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}
