import { openDB, type DBSchema, type IDBPDatabase, type StoreNames } from 'idb';
import type { SavedLocation, SavedMarker, SavedPlan, ScapeExport } from '@core/plan';

export type { SavedLocation, SavedMarker, SavedPlan } from '@core/plan';

interface ScapeDB extends DBSchema {
  locations: { key: string; value: SavedLocation; indexes: { byName: string } };
  markers: { key: string; value: SavedMarker; indexes: { byName: string } };
  plans: { key: string; value: SavedPlan; indexes: { byName: string } };
}

type Store = StoreNames<ScapeDB>;

let dbp: Promise<IDBPDatabase<ScapeDB>> | null = null;

export function db(): Promise<IDBPDatabase<ScapeDB>> {
  dbp ??= openDB<ScapeDB>('scape', 2, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) d.createObjectStore('locations', { keyPath: 'id' }).createIndex('byName', 'name');
      if (oldVersion < 2) {
        d.createObjectStore('markers', { keyPath: 'id' }).createIndex('byName', 'name');
        d.createObjectStore('plans', { keyPath: 'id' }).createIndex('byName', 'name');
      }
    }
  });
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
  const [locations, markers, plans] = await Promise.all([listAll('locations'), listAll('markers'), listAll('plans')]);
  return { format: 'scape', version: 1, exportedAt: new Date().toISOString(), locations, markers, plans };
}

export const ImportMode = { Merge: 'Merge', Replace: 'Replace' } as const;
export type ImportMode = (typeof ImportMode)[keyof typeof ImportMode];

export function isScapeExport(v: unknown): v is ScapeExport {
  const o = v as Partial<ScapeExport> | null;
  return !!o && o.format === 'scape' && Array.isArray(o.locations) && Array.isArray(o.markers) && Array.isArray(o.plans);
}

/** Merge keeps existing records with other ids; replace wipes the three stores first. */
export async function importAll(data: ScapeExport, mode: ImportMode): Promise<void> {
  const d = await db();
  const tx = d.transaction(['locations', 'markers', 'plans'], 'readwrite');
  if (mode === ImportMode.Replace) await Promise.all([tx.objectStore('locations').clear(), tx.objectStore('markers').clear(), tx.objectStore('plans').clear()]);
  await Promise.all([
    ...data.locations.map((l) => tx.objectStore('locations').put(l)),
    ...data.markers.map((m) => tx.objectStore('markers').put(m)),
    ...data.plans.map((p) => tx.objectStore('plans').put(p))
  ]);
  await tx.done;
}
