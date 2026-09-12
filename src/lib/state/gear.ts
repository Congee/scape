import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SENSORS, type SensorFormat } from '@core/optics/fov';

export const DEFAULT_FOCALS = [14, 16, 20, 24, 28, 35, 50, 70, 85, 100, 135, 200, 300, 400, 600];

export interface GearState {
  /** User-defined sensor formats, listed after the built-in ones. */
  cameras: SensorFormat[];
  /** Quick-pick focal lengths, mm. */
  focalPresets: number[];
  addCamera(c: Omit<SensorFormat, 'id'>): string;
  removeCamera(id: string): void;
  setFocalPresets(list: number[]): void;
}

export const gearStore = create<GearState>()(
  persist(
    (set) => ({
      cameras: [],
      focalPresets: DEFAULT_FOCALS,
      addCamera: (c) => {
        const id = `custom:${crypto.randomUUID()}`;
        set((s) => ({ cameras: [...s.cameras, { ...c, id }] }));
        return id;
      },
      removeCamera: (id) => set((s) => ({ cameras: s.cameras.filter((c) => c.id !== id) })),
      setFocalPresets: (list) => set({ focalPresets: [...new Set(list.filter((f) => f > 0))].toSorted((a, b) => a - b) })
    }),
    { name: 'scape.gear', partialize: ({ cameras, focalPresets }) => ({ cameras, focalPresets }) }
  )
);

export const useGear = gearStore;

export function allSensors(custom: SensorFormat[]): SensorFormat[] {
  return [...SENSORS, ...custom];
}

export function sensorById(id: string, custom: SensorFormat[]): SensorFormat {
  return allSensors(custom).find((s) => s.id === id) ?? SENSORS[0];
}
