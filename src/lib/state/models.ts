import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { suppressRing, type SuppressRing } from '@core/geo/buildingTiles';
import { modelTriangles } from '@core/geo/modelPlace';
import { modelOutlines, partsFootprint, type SavedModel } from '@core/model';
import { drawnModel } from '@core/model/draw';
import { modelMesh } from '@core/model/mesh';
import { exportModelGlb, modelFileName } from '@core/model/share';
import { deleteOne, listAll, putOne } from '@data/db';
import { buildingHeightAt, groundUnder, setBuildingModels } from './buildings';

export interface ModelsState {
  models: SavedModel[];
  loaded: boolean;
  /** Bumps on every change the renderers and workers must rebuild for. */
  rev: number;
  selectedId: string | null;
  /** The part the map shows handles for and the nudges raise. */
  selectedPartId: string | null;
  /** Map taps add footprint vertices, lng/lat; null when not drawing. */
  draft: [number, number][] | null;
  /** Drawing squares each corner to the one before. */
  rightAngles: boolean;
  /** Arrow keys in the viewfinder nudge the selected model instead of aiming. */
  adjusting: boolean;
  /** Next map click seeds a model from the Overture building under it. */
  picking: boolean;
  /** Why the last pick made no model; cleared by the next pick. */
  pickError: string | null;
  load(): Promise<void>;
  save(m: SavedModel): Promise<SavedModel>;
  /** Applies `patch`, re-deriving the footprint from the parts. */
  update(id: string, patch: Partial<SavedModel>): Promise<SavedModel | null>;
  remove(id: string): Promise<void>;
  /** Saves a placed import draft and selects it. */
  importDraft(m: SavedModel): Promise<SavedModel>;
  /** One model as a GLB download; throws GltfError when it has no mesh. */
  exportGlb(id: string, withParts?: boolean): { fileName: string; glb: ArrayBuffer } | null;
  select(id: string | null): void;
  selectPart(id: string | null): void;
  setPicking(on: boolean): void;
  setDraft(draft: [number, number][] | null): void;
  setRightAngles(on: boolean): void;
  setAdjusting(on: boolean): void;
}

const CHANNEL = 'scape.models';
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);

export const modelsStore = create<ModelsState>()(
  subscribeWithSelector((set, get) => ({
    models: [],
    loaded: false,
    rev: 0,
    selectedId: null,
    selectedPartId: null,
    draft: null,
    rightAngles: true,
    adjusting: false,
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
    select: (selectedId) => set((s) => (s.selectedId === selectedId ? {} : { selectedId, selectedPartId: null })),
    selectPart: (selectedPartId) => set({ selectedPartId }),
    setPicking: (picking) => set(picking ? { picking, pickError: null, draft: null } : { picking }),
    setDraft: (draft) => set(draft ? { draft, picking: false } : { draft }),
    setRightAngles: (rightAngles) => set({ rightAngles }),
    setAdjusting: (adjusting) => set({ adjusting })
  }))
);

// Another tab's map edits a model this tab's viewfinder draws.
channel?.addEventListener('message', () => void modelsStore.getState().load());

export const useModels = modelsStore;

/** Without an Overture building under the draft to copy. */
const DRAWN_HEIGHT_M = 10;

/** Saves the draft as a Drawn model standing on the DEM, as tall as the Overture building it traces, and selects its part. */
export async function finishDraft(): Promise<SavedModel | null> {
  const st = modelsStore.getState();
  const draft = st.draft;
  if (!draft || draft.length < 3) return null;
  st.setDraft(null);
  const pts = draft.map(([lng, lat]) => ({ lng, lat }));
  const c = { lng: pts.reduce((a, p) => a + p.lng, 0) / pts.length, lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length };
  const [heightM, groundM] = await Promise.all([buildingHeightAt(c).catch(() => null), groundUnder(pts).catch(() => null)]);
  const m = drawnModel(pts, `Model ${st.models.length + 1}`, heightM ?? DRAWN_HEIGHT_M);
  if (!m) return null;
  m.groundM = groundM ?? NaN;
  await modelsStore.getState().save(m);
  modelsStore.getState().select(m.id);
  modelsStore.getState().selectPart(m.parts![0].id);
  return m;
}

/** A hidden model gives the Overture rows back. */
const suppresses = (m: SavedModel) => m.visible && m.suppressOverture && m.footprint.length >= 3;

let suppressCache: { models: SavedModel[]; key: string; rings: SuppressRing[] } | null = null;

/** Footprints hiding Overture rows, and a key that changes only when they do. */
export function modelSuppression(): { key: string; rings: SuppressRing[] } {
  const { models } = modelsStore.getState();
  if (suppressCache?.models !== models) {
    const rings = models.filter(suppresses).flatMap(modelOutlines);
    suppressCache = { models, key: rings.map((r) => r.flat().join(',')).join('|'), rings: rings.map(suppressRing) };
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
        return { id: m.id, suppress: suppresses(m) ? modelOutlines(m) : [], tris: mesh ? modelTriangles(mesh, m.anchor, m.groundM) : new Float64Array(0) };
      })
    );
  };
  push();
  return modelsStore.subscribe((s) => s.rev, push);
}
