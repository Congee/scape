import { create } from 'zustand';
import { planTeleconverters, type SavedPlan } from '@core/plan';
import { deleteOne, listAll, putOne } from '@data/db';
import { compositionStore } from './composition';
import { worldStore } from './world';

export interface PlansState {
  plans: SavedPlan[];
  loaded: boolean;
  load(): Promise<void>;
  save(plan: SavedPlan): Promise<void>;
  remove(id: string): Promise<void>;
}

export const plansStore = create<PlansState>()((set, get) => ({
  plans: [],
  loaded: false,
  load: async () => {
    set({ plans: await listAll('plans'), loaded: true });
  },
  save: async (plan) => {
    await putOne('plans', plan);
    await get().load();
  },
  remove: async (id) => {
    await deleteOne('plans', id);
    await get().load();
  }
}));

export const usePlans = plansStore;

/** Snapshot of the current camera, target, moment and composition. */
export function capturePlan(name: string, existing?: SavedPlan): SavedPlan {
  const w = worldStore.getState();
  const c = compositionStore.getState();
  const now = Date.now();
  return {
    id: existing?.id ?? crypto.randomUUID(),
    name: name.trim() || existing?.name || 'Plan',
    camera: { lat: w.pin.lat, lng: w.pin.lng, digits: w.pin.digits, heightM: w.pinHeightM },
    target: w.pin2 ? { lat: w.pin2.lat, lng: w.pin2.lng, digits: w.pin2.digits, heightM: w.pin2HeightM } : null,
    time: w.time,
    tz: w.tz,
    tzAuto: w.tzAuto,
    composition: {
      sensorId: c.sensorId,
      focalMm: c.focalMm,
      fNumber: c.fNumber,
      teleconverters: c.teleconverters,
      orientation: c.orientation,
      azimuthDeg: c.azimuthDeg,
      elevationDeg: c.elevationDeg,
      aimAtTarget: c.aimAtTarget
    },
    notes: existing?.notes ?? '',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

/** Loads a plan into the world and composition and flies the map to the camera. */
export function applyPlan(p: SavedPlan): void {
  const w = worldStore.getState();
  w.setPin({ lat: p.camera.lat, lng: p.camera.lng, digits: p.camera.digits });
  w.setPinHeight(p.camera.heightM);
  w.setPin2(p.target ? { lat: p.target.lat, lng: p.target.lng, digits: p.target.digits } : null);
  w.setPin2Height(p.target?.heightM ?? 0);
  w.setTz(p.tzAuto ? null : p.tz);
  w.setTime(p.time);
  const { teleconverter: _legacy, ...pc } = p.composition;
  compositionStore.getState().update({ ...pc, teleconverters: planTeleconverters(p.composition) });
  w.flyTo({ lat: p.camera.lat, lng: p.camera.lng }, Math.max(w.view.zoom, 12), false);
}
