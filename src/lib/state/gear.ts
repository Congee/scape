import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { clampFocalMm, fitToLens, SENSORS, tcFactor, type LensSpec, type SensorFormat } from '@core/optics/fov';
import { compositionStore, type Composition } from './composition';

export const DEFAULT_FOCALS = [14, 16, 20, 24, 28, 35, 50, 70, 85, 100, 135, 200, 300, 400, 600, 900, 1200];

/** A saved camera + lens pairing, applied in one click from the Frame tab. */
export interface Kit {
  id: string;
  name: string;
  cameraId: string;
  lensId: string | null;
}

export interface GearState {
  /** User-defined sensor formats, listed after the built-in ones. */
  cameras: SensorFormat[];
  /** The user's lenses. */
  lenses: LensSpec[];
  /** Quick-pick focal lengths, mm. */
  focalPresets: number[];
  /** Saved camera + lens pairings. */
  kits: Kit[];
  /** Adds (or replaces, by id) a camera and returns its id. */
  addCamera(c: Omit<SensorFormat, 'id'> & { id?: string }): string;
  removeCamera(id: string): void;
  addLens(l: Omit<LensSpec, 'id'> & { id?: string }): string;
  removeLens(id: string): void;
  setFocalPresets(list: number[]): void;
  /** Adds (or replaces, by camera + lens) a kit and returns its id. */
  saveKit(name: string, cameraId: string, lensId: string | null): string;
  removeKit(id: string): void;
  renameKit(id: string, name: string): void;
}

/** The slice of {@link GearState} written to storage. */
type PersistedGear = Pick<GearState, 'cameras' | 'lenses' | 'focalPresets' | 'kits'>;

export const GEAR_VERSION = 3;

const sortedFocals = (list: number[]): number[] => [...new Set(list.filter((f) => f > 0))].toSorted((a, b) => a - b);

/** Drops the long-end aperture that v2 stored on zooms. */
function withoutLongAperture(lens: LensSpec): LensSpec {
  if (!lens || typeof lens !== 'object' || !('maxApertureLong' in lens)) return lens;
  const { maxApertureLong: _, ...rest } = lens as LensSpec & { maxApertureLong?: number };
  return rest;
}

/**
 * v0 -> v1: unions the stored focal presets with the shipped defaults, so a profile written before a
 * default was added still sees it. Nothing records a preset the user deleted, so a deletion cannot be
 * told apart from "never existed": the union re-adds deleted defaults, but the alternatives would either
 * drop the user's own presets or hide every newly shipped one.
 *
 * v1 -> v2 filled in `maxApertureLong`; v2 -> v3 strips it again, a no-op on older profiles.
 * The steps are gated separately so a v1 profile does not re-run the preset union.
 */
export function migrateGear(persisted: unknown, version: number): PersistedGear {
  const s = (persisted ?? {}) as Partial<PersistedGear>;
  const stored = Array.isArray(s.focalPresets) ? s.focalPresets : [];
  const lenses = Array.isArray(s.lenses) ? s.lenses : [];
  return {
    cameras: s.cameras ?? [],
    lenses: version >= 3 ? lenses : lenses.map(withoutLongAperture),
    kits: s.kits ?? [],
    focalPresets: version >= 1 ? sortedFocals(stored) : sortedFocals([...stored, ...DEFAULT_FOCALS])
  };
}

/** Exported so a test can check the store is wired to the migration, which storage-less Node hides. */
export const GEAR_PERSIST = {
  name: 'scape.gear',
  version: GEAR_VERSION,
  migrate: migrateGear,
  partialize: ({ cameras, lenses, focalPresets, kits }: GearState): PersistedGear => ({ cameras, lenses, focalPresets, kits })
};

export const gearStore = create<GearState>()(
  persist(
    (set) => ({
      cameras: [],
      lenses: [],
      focalPresets: DEFAULT_FOCALS,
      kits: [],
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
      setFocalPresets: (list) => set({ focalPresets: sortedFocals(list) }),
      saveKit: (name, cameraId, lensId) => {
        const id = crypto.randomUUID();
        set((s) => ({ kits: [...s.kits.filter((k) => !(k.cameraId === cameraId && k.lensId === lensId)), { id, name, cameraId, lensId }] }));
        return id;
      },
      removeKit: (id) => set((s) => ({ kits: s.kits.filter((k) => k.id !== id) })),
      renameKit: (id, name) => set((s) => ({ kits: s.kits.map((k) => (k.id === id ? { ...k, name } : k)) }))
    }),
    GEAR_PERSIST
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

/** "Sony α7R V + FE 100-400mm…": the lens make is dropped when the camera name already says it. */
export function defaultKitName(cameraName: string, lensName: string | null): string {
  if (!lensName) return cameraName;
  const make = `${cameraName.split(' ')[0]} `;
  return `${cameraName} + ${lensName.startsWith(make) ? lensName.slice(make.length) : lensName}`;
}

export function kitMatches(kit: Kit, c: { sensorId: string; lensId: string | null }): boolean {
  return kit.cameraId === c.sensorId && kit.lensId === c.lensId;
}

/** Zoom gestures: the focal inside the mounted lens's range. */
export function zoomPatch(c: Composition, focalMm: number): { focalMm: number } {
  const lens = lensById(c.lensId, gearStore.getState().lenses);
  return { focalMm: clampFocalMm(focalMm, lens, tcFactor(c.teleconverters)) };
}

/** Selects the kit's camera and lens, fitting the focal length and aperture to the lens. */
export function applyKit(kit: Kit): void {
  const c = compositionStore.getState();
  const lens = lensById(kit.lensId, gearStore.getState().lenses);
  c.update({ sensorId: kit.cameraId, lensId: lens?.id ?? null, ...fitToLens(lens, c.focalMm, c.fNumber) });
}
