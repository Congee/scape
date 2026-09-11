import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface SavedLocation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  tz?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

interface ScapeDB extends DBSchema {
  locations: { key: string; value: SavedLocation; indexes: { byName: string } };
}

let dbp: Promise<IDBPDatabase<ScapeDB>> | null = null;

export function db(): Promise<IDBPDatabase<ScapeDB>> {
  dbp ??= openDB<ScapeDB>('scape', 1, {
    upgrade(d) {
      const s = d.createObjectStore('locations', { keyPath: 'id' });
      s.createIndex('byName', 'name');
    }
  });
  return dbp;
}

export async function listLocations(): Promise<SavedLocation[]> {
  return (await db()).getAllFromIndex('locations', 'byName');
}

export async function putLocation(loc: SavedLocation): Promise<void> {
  await (await db()).put('locations', loc);
}

export async function deleteLocation(id: string): Promise<void> {
  await (await db()).delete('locations', id);
}
