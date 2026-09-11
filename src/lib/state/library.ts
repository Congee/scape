import { create } from 'zustand';
import { deleteLocation, listLocations, putLocation, type SavedLocation } from '@data/db';

export interface LibraryState {
  locations: SavedLocation[];
  loaded: boolean;
  load(): Promise<void>;
  save(input: Pick<SavedLocation, 'name' | 'lat' | 'lng'> & Partial<SavedLocation>): Promise<void>;
  remove(id: string): Promise<void>;
}

export const libraryStore = create<LibraryState>()((set, get) => ({
  locations: [],
  loaded: false,
  load: async () => {
    set({ locations: await listLocations(), loaded: true });
  },
  save: async (input) => {
    const now = Date.now();
    const loc: SavedLocation = { id: input.id ?? crypto.randomUUID(), createdAt: input.createdAt ?? now, ...input, updatedAt: now };
    await putLocation(loc);
    await get().load();
  },
  remove: async (id) => {
    await deleteLocation(id);
    await get().load();
  }
}));

export const useLibrary = libraryStore;
