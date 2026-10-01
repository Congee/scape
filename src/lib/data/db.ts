import { openDB, type DBSchema, type IDBPDatabase, type StoreNames } from 'idb';
import type { SavedModel } from '@core/model';
import { fromModelRecord, isModelRecord, modelRecord } from '@core/model/share';
import type { SavedLocation, SavedMarker, SavedPlan, SavedSearch, ScapeExport } from '@core/plan';

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

export function isScapeExport(v: unknown): v is ScapeExport {
  const o = v as Partial<ScapeExport> | null;
  return (
    !!o &&
    o.format === 'scape' && Array.isArray(o.locations) && Array.isArray(o.markers) && Array.isArray(o.plans) && (o.searches === undefined || Array.isArray(o.searches)) &&
    (o.models === undefined || (Array.isArray(o.models) && o.models.every(isModelRecord)))
  );
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
