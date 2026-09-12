import { create } from 'zustand';
import type { LngLat } from '@core/geo/geodesy';
import type { SavedSearch } from '@core/plan';
import { deleteOne, listAll, putOne } from '@data/db';
import { finderStore } from './finder';
import { worldStore } from './world';

export interface SearchesState {
  searches: SavedSearch[];
  loaded: boolean;
  load(): Promise<void>;
  /** Stores the finder's current settings under a name. */
  save(name: string, pin: LngLat | null): Promise<SavedSearch>;
  remove(id: string): Promise<void>;
  /** Loads a search into the finder and runs it; `here` keeps the current camera position. */
  apply(id: string, o: { here: boolean }): void;
}

export const searchesStore = create<SearchesState>()((set, get) => ({
  searches: [],
  loaded: false,
  load: async () => {
    set({ searches: await listAll('searches'), loaded: true });
  },
  save: async (name, pin) => {
    const now = Date.now();
    const existing = get().searches.find((s) => s.name === name.trim());
    const search: SavedSearch = {
      id: existing?.id ?? crypto.randomUUID(),
      name: name.trim() || 'Search',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      pin,
      settings: { ...finderStore.getState().settings }
    };
    await putOne('searches', search);
    await get().load();
    return search;
  },
  remove: async (id) => {
    await deleteOne('searches', id);
    await get().load();
  },
  apply: (id, o) => {
    const s = get().searches.find((x) => x.id === id);
    if (!s) return;
    finderStore.setState({ settings: { ...s.settings } });
    if (!o.here && s.pin) worldStore.getState().setPin(s.pin);
    finderStore.getState().run();
  }
}));

export const useSearches = searchesStore;
