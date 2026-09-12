import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

/** Azimuth window the viewfinder wants swept; null while no viewfinder is open. */
export interface ViewWindow {
  azFromDeg: number;
  azSpanDeg: number;
  azStepDeg: number;
  rangeM: number;
  minStepDeg: number;
}

export interface ViewfinderState {
  window: ViewWindow | null;
  setWindow(window: ViewWindow | null): void;
}

export const viewfinderStore = create<ViewfinderState>()(
  subscribeWithSelector((set) => ({
    window: null,
    setWindow: (window) => set({ window })
  }))
);

export const useViewfinder = viewfinderStore;
