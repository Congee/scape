import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { suppressRing, type SuppressRing } from '@core/geo/buildingTiles';
import { modelTriangles } from '@core/geo/modelPlace';
import { groundUnknown, modelOutlines, type SavedModel } from '@core/model';
import { drawnModel } from '@core/model/draw';
import { modelFootprint, modelMesh } from '@core/model/mesh';
import { exportModelGlb, modelFileName } from '@core/model/share';
import { deleteOne, listAll, putOne } from '@data/db';
import { buildingHeightAt, groundUnder, setBuildingModels } from './buildings';
import { groundKey, groundRefresher } from './modelGround';

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
  /** Map clicks choose the Overture building the import being placed goes on, until the sheet confirms. */
  importPick: boolean;
  /** The chosen building's centre; the sheet reads and clears it. */
  importAt: { lng: number; lat: number } | null;
  /** The chosen building's rings, lng/lat, which the map highlights. */
  importRings: [number, number][][];
  load(): Promise<void>;
  save(m: SavedModel): Promise<SavedModel>;
  /** Applies `patch`, re-deriving the footprint from the parts or the mesh at the new anchor. */
  update(id: string, patch: Partial<SavedModel>): Promise<SavedModel | null>;
  remove(id: string): Promise<void>;
  /** Saves a placed import draft and selects it. */
  importDraft(m: SavedModel): Promise<SavedModel>;
  /** One model as a GLB download; throws GltfError when it has no mesh. */
  exportGlb(id: string, withParts?: boolean): { fileName: string; glb: ArrayBuffer } | null;
  select(id: string | null): void;
  selectPart(id: string | null): void;
  setPicking(on: boolean): void;
  setImportPick(on: boolean): void;
  setDraft(draft: [number, number][] | null): void;
  setRightAngles(on: boolean): void;
  setAdjusting(on: boolean): void;
}

const healTried = new Set<string>();

/** Re-resolves the ground of models saved while the DEM was unreadable, once per model per session. */
async function healGrounds(models: SavedModel[]): Promise<void> {
  const lost = models.filter((m) => groundUnknown(m) && m.footprint.length >= 3 && !healTried.has(m.id));
  await Promise.all(
    lost.map(async (m) => {
      healTried.add(m.id);
      const groundM = await groundUnder(m.footprint.map(([lng, lat]) => ({ lng, lat }))).catch(() => null);
      const cur = modelsStore.getState().models.find((x) => x.id === m.id);
      if (groundM !== null && cur && Number.isNaN(cur.groundM)) await modelsStore.getState().save({ ...cur, groundM });
    })
  );
}

/** Reads the ground of a model saved at sea level again, now; false when the DEM still cannot say. */
export async function retryGround(id: string): Promise<boolean> {
  const m = modelsStore.getState().models.find((x) => x.id === id);
  if (!m || !groundUnknown(m)) return true;
  const groundM = await groundUnder(m.footprint.map(([lng, lat]) => ({ lng, lat }))).catch(() => null);
  const cur = modelsStore.getState().models.find((x) => x.id === id);
  if (groundM === null || !cur) return false;
  if (Number.isNaN(cur.groundM)) await modelsStore.getState().save({ ...cur, groundM });
  return true;
}

/** Keeps the buffer already loaded when the bytes match, so the mesh parse cache survives a reload of the store. */
function sameGlb(m: SavedModel, old: ArrayBuffer | undefined): SavedModel {
  if (!m.glb || !old || old.byteLength !== m.glb.byteLength) return m;
  const a = new Uint8Array(m.glb);
  const b = new Uint8Array(old);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return m;
  return { ...m, glb: old };
}

/** Coalesces a nudge burst into one ground read. */
const GROUND_DEBOUNCE_MS = 250;

const refreshGround = groundRefresher({
  resolve: (footprint) => groundUnder(footprint.map(([lng, lat]) => ({ lng, lat }))),
  current: (id) => modelsStore.getState().models.find((m) => m.id === id),
  apply: (m, groundM) => {
    // An unreadable DEM here gets the load-time heal's retry.
    healTried.delete(m.id);
    return modelsStore.getState().save({ ...m, groundM });
  },
  delayMs: GROUND_DEBOUNCE_MS
});

const CHANNEL = 'scape.models';
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);

const NO_IMPORT_PICK = { importPick: false, importAt: null, importRings: [] };

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
    importPick: false,
    importAt: null,
    importRings: [],
    load: async () => {
      const prev = new Map(get().models.map((m) => [m.id, m.glb]));
      const models = (await listAll('models')).map((m) => sameGlb(typeof m.groundM === 'number' ? m : { ...m, groundM: NaN }, prev.get(m.id)));
      set((s) => ({ models, loaded: true, rev: s.rev + 1 }));
      void healGrounds(models);
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
      if (next.parts || next.glb) next.footprint = modelFootprint(next);
      const saved = await get().save(next);
      const key = groundKey(next);
      if (key !== null && key !== groundKey(old)) refreshGround(id);
      return saved;
    },
    remove: async (id) => {
      await deleteOne('models', id);
      set((s) => ({ selectedId: s.selectedId === id ? null : s.selectedId }));
      await get().load();
      channel?.postMessage('changed');
    },
    importDraft: async (m) => {
      const saved = await get().save({ ...m, updatedAt: Date.now() });
      get().select(saved.id);
      return saved;
    },
    exportGlb: (id, withParts) => {
      const m = get().models.find((x) => x.id === id);
      return m ? { fileName: modelFileName(m), glb: exportModelGlb(m, withParts) } : null;
    },
    select: (selectedId) => set((s) => (s.selectedId === selectedId ? {} : { selectedId, selectedPartId: s.models.find((m) => m.id === selectedId)?.parts?.[0]?.id ?? null })),
    selectPart: (selectedPartId) => set({ selectedPartId }),
    setPicking: (picking) => set(picking ? { picking, pickError: null, draft: null, ...NO_IMPORT_PICK } : { picking }),
    setImportPick: (importPick) => set(importPick ? { importPick, pickError: null, draft: null, picking: false } : NO_IMPORT_PICK),
    setDraft: (draft) => set(draft ? { draft, picking: false, ...NO_IMPORT_PICK } : { draft }),
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
  const m = drawnModel(pts, `Model ${st.models.length + 1}`, DRAWN_HEIGHT_M);
  if (!m) return null;
  // The footprint, as the heal and the nudge refresh read it, so they agree to the bit.
  const [heightM, groundM] = await Promise.all([buildingHeightAt(c).catch(() => null), groundUnder(m.footprint.map(([lng, lat]) => ({ lng, lat }))).catch(() => null)]);
  m.parts![0].heightM = heightM ?? DRAWN_HEIGHT_M;
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
