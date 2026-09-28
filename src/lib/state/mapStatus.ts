import { create } from 'zustand';
import type { LngLat } from '@core/geo/geodesy';

export interface MapStatusState {
  /** Last basemap/tile error message, cleared when a style loads cleanly. */
  error: string | null;
  /** Whether the loaded basemap puts `p` in town; null until the map has looked there. */
  urban: { p: LngLat; urban: boolean } | null;
  setError(error: string | null): void;
  setUrban(p: LngLat, urban: boolean): void;
}

export const mapStatusStore = create<MapStatusState>()((set, get) => ({
  error: null,
  urban: null,
  setError: (error) => set({ error }),
  setUrban: (p, urban) => {
    const u = get().urban;
    if (u?.urban !== urban || u.p.lat !== p.lat || u.p.lng !== p.lng) set({ urban: { p, urban } });
  }
}));

export const useMapStatus = mapStatusStore;
