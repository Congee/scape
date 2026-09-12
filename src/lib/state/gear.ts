import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SENSORS, type LensSpec, type SensorFormat } from '@core/optics/fov';

export const DEFAULT_FOCALS = [14, 16, 20, 24, 28, 35, 50, 70, 85, 100, 135, 200, 300, 400, 600];

export interface GearState {
  /** User-defined sensor formats, listed after the built-in ones. */
  cameras: SensorFormat[];
  /** The user's lenses. */
  lenses: LensSpec[];
  /** Quick-pick focal lengths, mm. */
  focalPresets: number[];
  /** Adds (or replaces, by id) a camera and returns its id. */
  addCamera(c: Omit<SensorFormat, 'id'> & { id?: string }): string;
  removeCamera(id: string): void;
  addLens(l: Omit<LensSpec, 'id'> & { id?: string }): string;
  removeLens(id: string): void;
  setFocalPresets(list: number[]): void;
}

export const gearStore = create<GearState>()(
  persist(
    (set) => ({
      cameras: [],
      lenses: [],
      focalPresets: DEFAULT_FOCALS,
      addCamera: (c) => {
        const id = c.id ?? `custom:${crypto.randomUUID()}`;
        set((s) => ({ cameras: [...s.cameras.filter((x) => x.id !== id), { ...c, id }] }));
        return id;
      },
      removeCamera: (id) => set((s) => ({ cameras: s.cameras.filter((c) => c.id !== id) })),
      addLens: (l) => {
        const id = l.id ?? `custom:${crypto.randomUUID()}`;
        set((s) => ({ lenses: [...s.lenses.filter((x) => x.id !== id), { ...l, id }] }));
        return id;
      },
      removeLens: (id) => set((s) => ({ lenses: s.lenses.filter((l) => l.id !== id) })),
      setFocalPresets: (list) => set({ focalPresets: [...new Set(list.filter((f) => f > 0))].toSorted((a, b) => a - b) })
    }),
    { name: 'scape.gear', partialize: ({ cameras, lenses, focalPresets }) => ({ cameras, lenses, focalPresets }) }
  )
);

export const useGear = gearStore;

export function allSensors(custom: SensorFormat[]): SensorFormat[] {
  return [...SENSORS, ...custom];
}

export function sensorById(id: string, custom: SensorFormat[]): SensorFormat {
  return allSensors(custom).find((s) => s.id === id) ?? SENSORS[0];
}

export function lensById(id: string | null, lenses: LensSpec[]): LensSpec | null {
  return id ? (lenses.find((l) => l.id === id) ?? null) : null;
}
