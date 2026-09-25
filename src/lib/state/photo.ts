import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { effectiveOptics, frameFov } from '@core/optics/fov';
import { focal35FromJpeg } from '@core/photo/exif';
import { focal35ForHfov, type PhotoPlacement } from '@core/photo/fit';
import { compositionStore } from './composition';
import { gearStore, sensorById } from './gear';

/** A reference photo over the viewfinder frame; memory only, so a reload drops it. */
export interface PhotoState extends Omit<PhotoPlacement, 'w' | 'h'> {
  /** Object URL of the loaded photo, null when none. */
  url: string | null;
  name: string;
  w: number;
  h: number;
  /** False when the photo had no Exif focal length and took the lens in use at load. */
  fromExif: boolean;
  opacity: number;
  error: string | null;
  load(file: File): Promise<void>;
  clear(): void;
  update(patch: Partial<Pick<PhotoState, 'opacity' | 'dx' | 'dy' | 'rotDeg'>>): void;
}

const EMPTY = { url: null, name: '', w: 0, h: 0, focal35: 0, fromExif: false, dx: 0, dy: 0, rotDeg: 0, error: null };

/** The frame's horizontal field of view with the current camera and lens. */
function lensHfovDeg(): number {
  const c = compositionStore.getState();
  return frameFov(sensorById(c.sensorId, gearStore.getState().cameras), effectiveOptics(c).focalMm, c.orientation).hDeg;
}

/** Natural size after the browser applies the Exif orientation. */
function decodedSize(url: string): Promise<{ w: number; h: number }> {
  const img = new Image();
  img.src = url;
  return img.decode().then(() => ({ w: img.naturalWidth, h: img.naturalHeight }));
}

export const photoStore = create<PhotoState>()(
  subscribeWithSelector((set, get) => ({
    ...EMPTY,
    opacity: 0.5,
    load: async (file) => {
      const url = URL.createObjectURL(file);
      // The lens as the photo was picked, not after the decode.
      const hfovDeg = lensHfovDeg();
      try {
        const [size, bytes] = await Promise.all([decodedSize(url), file.arrayBuffer()]);
        const old = get().url;
        if (old) URL.revokeObjectURL(old);
        const exif = focal35FromJpeg(new Uint8Array(bytes));
        set({ ...EMPTY, url, name: file.name, w: size.w, h: size.h, focal35: exif ?? focal35ForHfov(hfovDeg, size.w, size.h), fromExif: exif !== null });
      } catch {
        URL.revokeObjectURL(url);
        set({ error: `Could not read ${file.name} as an image` });
      }
    },
    clear: () => {
      const old = get().url;
      if (old) URL.revokeObjectURL(old);
      set(EMPTY);
    },
    update: (patch) => set(patch)
  }))
);

export const usePhoto = photoStore;
