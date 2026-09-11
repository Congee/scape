import { create } from 'zustand';

export interface MapStatusState {
  /** Last basemap/tile error message, cleared when a style loads cleanly. */
  error: string | null;
  setError(error: string | null): void;
}

export const mapStatusStore = create<MapStatusState>()((set) => ({
  error: null,
  setError: (error) => set({ error })
}));

export const useMapStatus = mapStatusStore;
