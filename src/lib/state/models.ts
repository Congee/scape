import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { partsFootprint, type SavedModel } from '@core/model';
import { deleteOne, listAll, putOne } from '@data/db';

export interface ModelsState {
  models: SavedModel[];
  loaded: boolean;
  /** Bumps on every change the renderers and workers must rebuild for. */
  rev: number;
  selectedId: string | null;
  /** Next map click seeds a model from the Overture building under it. */
  picking: boolean;
  load(): Promise<void>;
  save(m: SavedModel): Promise<SavedModel>;
  /** Applies `patch`, re-deriving the footprint from the parts. */
  update(id: string, patch: Partial<SavedModel>): Promise<SavedModel | null>;
  remove(id: string): Promise<void>;
  select(id: string | null): void;
  setPicking(on: boolean): void;
}

const CHANNEL = 'scape.models';
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);

export const modelsStore = create<ModelsState>()(
  subscribeWithSelector((set, get) => ({
    models: [],
    loaded: false,
    rev: 0,
    selectedId: null,
    picking: false,
    load: async () => {
      const models = await listAll('models');
      set((s) => ({ models, loaded: true, rev: s.rev + 1 }));
    },
    save: async (m) => {
      await putOne('models', m);
      await get().load();
      channel?.postMessage('changed');
      return m;
    },
    update: async (id, patch) => {
      const old = get().models.find((m) => m.id === id);
      if (!old) return null;
      const next: SavedModel = { ...old, ...patch, updatedAt: Date.now() };
      if (next.parts) next.footprint = partsFootprint(next.anchor, next.parts);
      return get().save(next);
    },
    remove: async (id) => {
      await deleteOne('models', id);
      set((s) => ({ selectedId: s.selectedId === id ? null : s.selectedId }));
      await get().load();
      channel?.postMessage('changed');
    },
    select: (selectedId) => set({ selectedId }),
    setPicking: (picking) => set({ picking })
  }))
);

// Another tab's map edits a model this tab's viewfinder draws.
channel?.addEventListener('message', () => void modelsStore.getState().load());

export const useModels = modelsStore;
