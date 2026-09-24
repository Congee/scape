import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { suppressRing, type SuppressRing } from '@core/geo/buildingTiles';
import { modelTriangles } from '@core/geo/modelPlace';
import { partsFootprint, type SavedModel } from '@core/model';
import { modelMesh } from '@core/model/mesh';
import { deleteOne, listAll, putOne } from '@data/db';
import { setBuildingModels } from './buildings';

export interface ModelsState {
  models: SavedModel[];
  loaded: boolean;
  /** Bumps on every change the renderers and workers must rebuild for. */
  rev: number;
  selectedId: string | null;
  /** Next map click seeds a model from the Overture building under it. */
  picking: boolean;
  /** Why the last pick made no model; cleared by the next pick. */
  pickError: string | null;
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
    pickError: null,
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
    setPicking: (picking) => set(picking ? { picking, pickError: null } : { picking })
  }))
);

// Another tab's map edits a model this tab's viewfinder draws.
channel?.addEventListener('message', () => void modelsStore.getState().load());

export const useModels = modelsStore;

/** A hidden model gives the Overture rows back. */
const suppresses = (m: SavedModel) => m.visible && m.suppressOverture && m.footprint.length >= 3;

let suppressCache: { models: SavedModel[]; key: string; rings: SuppressRing[] } | null = null;

/** Footprints hiding Overture rows, and a key that changes only when they do. */
export function modelSuppression(): { key: string; rings: SuppressRing[] } {
  const { models } = modelsStore.getState();
  if (suppressCache?.models !== models) {
    const hide = models.filter(suppresses);
    suppressCache = { models, key: hide.map((m) => `${m.id}:${m.footprint.flat().join(',')}`).join('|'), rings: hide.map((m) => suppressRing(m.footprint)) };
  }
  return suppressCache;
}

/** Keeps both buildings workers' models in step with the store. */
export function startModelsSync(): () => void {
  const push = () => {
    const { models, rev } = modelsStore.getState();
    setBuildingModels(
      rev,
      models.map((m) => {
        const mesh = m.visible ? modelMesh(m) : null;
        return { id: m.id, footprint: m.footprint, suppress: suppresses(m), tris: mesh ? modelTriangles(mesh, m.anchor, m.groundM) : new Float64Array(0) };
      })
    );
  };
  push();
  return modelsStore.subscribe((s) => s.rev, push);
}
