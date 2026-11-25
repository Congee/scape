import { openDB, type DBSchema, type IDBPDatabase, type StoreNames } from 'idb';
import type { SavedModel } from '@core/model';
import { fromModelRecord, isModelRecord, modelRecord } from '@core/model/share';
import { DEFAULT_FINDER_SETTINGS, FINDER_SETTINGS_CHECKS } from '@core/astro/finder';
import { bool, checkFields, digits, inRange, isObject, listOf, lngLat, nullable, num, oneOf, optional, positive, record, str, timeZone, type Checks } from '@core/io/check';
import { Orientation, Teleconverter } from '@core/optics/fov';
import { MarkerCategory, MarkerShape, type PlanComposition, type PlanPoint, type SavedLocation, type SavedMarker, type SavedPlan, type SavedSearch, type ScapeExport } from '@core/plan';

export type { SavedLocation, SavedMarker, SavedPlan, SavedSearch } from '@core/plan';

interface ScapeDB extends DBSchema {
  locations: { key: string; value: SavedLocation; indexes: { byName: string } };
  markers: { key: string; value: SavedMarker; indexes: { byName: string } };
  plans: { key: string; value: SavedPlan; indexes: { byName: string } };
  searches: { key: string; value: SavedSearch; indexes: { byName: string } };
  models: { key: string; value: SavedModel; indexes: { byName: string } };
}

type Store = StoreNames<ScapeDB>;

export const DB_VERSION = 4;

/** The slice of an upgrading database that `upgradeScape` touches. */
export interface Upgradable {
  createObjectStore(name: Store, options: { keyPath: string }): { createIndex(name: 'byName', keyPath: string): unknown };
}

/** Creates every store added after `oldVersion`; each is keyed by `id` and listed by name. */
export function upgradeScape(d: Upgradable, oldVersion: number): void {
  const add = (name: Store) => d.createObjectStore(name, { keyPath: 'id' }).createIndex('byName', 'name');
  if (oldVersion < 1) add('locations');
  if (oldVersion < 2) {
    add('markers');
    add('plans');
  }
  if (oldVersion < 3) add('searches');
  if (oldVersion < 4) add('models');
}

let dbp: Promise<IDBPDatabase<ScapeDB>> | null = null;

export function db(): Promise<IDBPDatabase<ScapeDB>> {
  dbp ??= openDB<ScapeDB>('scape', DB_VERSION, { upgrade: (d, oldVersion) => upgradeScape(d, oldVersion) });
  return dbp;
}

export async function listAll<S extends Store>(store: S): Promise<ScapeDB[S]['value'][]> {
  return (await db()).getAllFromIndex(store, 'byName');
}

export async function putOne<S extends Store>(store: S, value: ScapeDB[S]['value']): Promise<void> {
  await (await db()).put(store, value);
}

export async function deleteOne(store: Store, id: string): Promise<void> {
  await (await db()).delete(store, id);
}

export const listLocations = () => listAll('locations');
export const putLocation = (l: SavedLocation) => putOne('locations', l);
export const deleteLocation = (id: string) => deleteOne('locations', id);

export async function exportAll(): Promise<ScapeExport> {
  const [locations, markers, plans, searches, models] = await Promise.all([listAll('locations'), listAll('markers'), listAll('plans'), listAll('searches'), listAll('models')]);
  return { format: 'scape', version: 1, exportedAt: new Date().toISOString(), locations, markers, plans, searches, models: models.map(modelRecord) };
}

export const ImportMode = { Merge: 'Merge', Replace: 'Replace' } as const;
export type ImportMode = (typeof ImportMode)[keyof typeof ImportMode];

const key = record<{ id: string; lat: number; lng: number }>({ id: str, lat: inRange(-90, 90), lng: num });
const point = record<PlanPoint>({ lat: inRange(-90, 90), lng: num, digits: optional(digits), heightM: num });

const LOCATION_CHECKS: Checks<SavedLocation> = { id: str, name: str, lat: num, lng: num, digits: optional(digits), tz: optional(timeZone), notes: optional(str), createdAt: num, updatedAt: num };

const MARKER_CHECKS: Checks<SavedMarker> = {
  id: str,
  name: str,
  category: oneOf(MarkerCategory),
  lat: num,
  lng: num,
  digits: optional(digits),
  heightM: num,
  widthM: num,
  shape: optional(oneOf(MarkerShape)),
  depthM: optional(num),
  rotationDeg: optional(num),
  rating: num,
  notes: str,
  showInViewfinder: bool,
  createdAt: num,
  updatedAt: num
};

const planComposition = record<PlanComposition>({
  sensorId: str,
  focalMm: positive,
  fNumber: positive,
  teleconverters: optional(listOf(oneOf(Teleconverter))),
  teleconverter: optional(oneOf(Teleconverter)),
  orientation: oneOf(Orientation),
  azimuthDeg: num,
  elevationDeg: num,
  aimLock: optional(str),
  aimAtTarget: optional(bool)
});

const PLAN_CHECKS: Checks<SavedPlan> = {
  id: str,
  name: str,
  camera: point,
  target: nullable(point),
  time: num,
  tz: timeZone,
  tzAuto: bool,
  composition: planComposition,
  notes: str,
  createdAt: num,
  updatedAt: num
};

const SEARCH_CHECKS: Checks<SavedSearch> = {
  id: str,
  name: str,
  createdAt: num,
  updatedAt: num,
  pin: nullable(lngLat),
  settings: (v) => (isObject(v) ? checkFields(FINDER_SETTINGS_CHECKS, v, DEFAULT_FINDER_SETTINGS) : undefined)
};

const stamps = (now: number) => ({ name: '', notes: '', createdAt: now, updatedAt: now });

function location(v: unknown, now: number): SavedLocation | undefined {
  const k = key(v);
  return k && checkFields(LOCATION_CHECKS, v, { ...stamps(now), ...k });
}

function marker(v: unknown, now: number): SavedMarker | undefined {
  const k = key(v);
  return k && checkFields(MARKER_CHECKS, v, { ...stamps(now), category: MarkerCategory.Other, heightM: 0, widthM: 0, rating: 0, showInViewfinder: true, ...k });
}

/** A plan needs its id, camera, moment and framing; the rest has defaults. */
function plan(v: unknown, now: number): SavedPlan | undefined {
  if (!isObject(v)) return undefined;
  const id = str(v.id);
  const camera = point(v.camera);
  const time = num(v.time);
  const composition = planComposition(v.composition);
  if (id === undefined || !camera || time === undefined || !composition) return undefined;
  return checkFields(PLAN_CHECKS, v, { ...stamps(now), id, camera, target: null, time, tz: 'Etc/UTC', tzAuto: true, composition });
}

function search(v: unknown, now: number): SavedSearch | undefined {
  const id = isObject(v) ? str(v.id) : undefined;
  return id === undefined ? undefined : checkFields(SEARCH_CHECKS, v, { ...stamps(now), id, pin: null, settings: DEFAULT_FINDER_SETTINGS });
}

const fail = (message: string): never => {
  throw new Error(message);
};

function each<T>(list: unknown, noun: string, read: (v: unknown, now: number) => T | undefined, now: number): T[] {
  if (!Array.isArray(list)) throw new Error('Not a Scape export file');
  return list.map((v, i) => read(v, now) ?? fail(`${noun} ${i + 1} in the file is damaged`));
}

/** A `.scape.json` export, checked record by record; throws naming the first bad one. Soft fields take defaults. */
export function parseScapeExport(v: unknown, now = Date.now()): ScapeExport {
  if (!isObject(v) || v.format !== 'scape') throw new Error('Not a Scape export file');
  return {
    format: 'scape',
    version: 1,
    exportedAt: str(v.exportedAt) ?? '',
    locations: each(v.locations, 'Location', location, now),
    markers: each(v.markers, 'Marker', marker, now),
    plans: each(v.plans, 'Plan', plan, now),
    ...(v.searches === undefined ? {} : { searches: each(v.searches, 'Search', search, now) }),
    ...(v.models === undefined ? {} : { models: each(v.models, 'Model', (m) => (isModelRecord(m) ? m : undefined), now) })
  };
}

export type StoreCounts = Record<Store, number>;

const STORES = ['locations', 'plans', 'markers', 'searches', 'models'] as const satisfies readonly Store[];

export async function countAll(): Promise<StoreCounts> {
  const d = await db();
  const n = await Promise.all(STORES.map((s) => d.count(s)));
  return Object.fromEntries(STORES.map((s, i) => [s, n[i]])) as StoreCounts;
}

const NOUN: Record<Store, [string, string]> = {
  locations: ['location', 'locations'],
  plans: ['plan', 'plans'],
  markers: ['marker', 'markers'],
  searches: ['search', 'searches'],
  models: ['3D model', '3D models']
};

/** The question before a Replace import, naming what it wipes; null when there is nothing to lose. */
export function replaceQuestion(c: StoreCounts): string | null {
  const parts = STORES.filter((s) => c[s] > 0).map((s) => `${c[s]} ${NOUN[s][c[s] === 1 ? 0 : 1]}`);
  if (!parts.length) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `Replace ${list} with this file?`;
}

/** Merge keeps existing records with other ids; replace wipes every store first. */
export async function importAll(data: ScapeExport, mode: ImportMode): Promise<void> {
  // Decoded first: a bad model fails the import before anything is written.
  const models = (data.models ?? []).map(fromModelRecord);
  const d = await db();
  const stores = ['locations', 'markers', 'plans', 'searches', 'models'] as const;
  const tx = d.transaction(stores, 'readwrite');
  if (mode === ImportMode.Replace) await Promise.all(stores.map((s) => tx.objectStore(s).clear()));
  await Promise.all([
    ...data.locations.map((l) => tx.objectStore('locations').put(l)),
    ...data.markers.map((m) => tx.objectStore('markers').put(m)),
    ...data.plans.map((p) => tx.objectStore('plans').put(p)),
    ...(data.searches ?? []).map((s) => tx.objectStore('searches').put(s)),
    ...models.map((m) => tx.objectStore('models').put(m))
  ]);
  await tx.done;
}
