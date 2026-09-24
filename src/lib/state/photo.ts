import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { focal35FromJpeg } from '@core/photo/exif';
import type { PhotoPlacement } from '@core/photo/fit';

/** A reference photo over the viewfinder frame; memory only, so a reload drops it. */
export interface PhotoState extends Omit<PhotoPlacement, 'w' | 'h'> {
  /** Object URL of the loaded photo, null when none. */
  url: string | null;
  name: string;
  w: number;
  h: number;
  opacity: number;
  error: string | null;
  load(file: File): Promise<void>;
  clear(): void;
  update(patch: Partial<Pick<PhotoState, 'opacity' | 'dx' | 'dy' | 'rotDeg'>>): void;
}

const EMPTY = { url: null, name: '', w: 0, h: 0, focal35: null, dx: 0, dy: 0, rotDeg: 0, error: null };

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
      try {
        const [size, bytes] = await Promise.all([decodedSize(url), file.arrayBuffer()]);
        const old = get().url;
        if (old) URL.revokeObjectURL(old);
        set({ ...EMPTY, url, name: file.name, w: size.w, h: size.h, focal35: focal35FromJpeg(new Uint8Array(bytes)) });
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
