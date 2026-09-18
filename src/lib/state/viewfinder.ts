import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { MeshView } from '@core/terrain/mesh';

/** Azimuth window the viewfinder wants swept; null while no viewfinder is open. */
export interface ViewWindow {
  azFromDeg: number;
  azSpanDeg: number;
  azStepDeg: number;
  rangeM: number;
  minStepDeg: number;
}

/**
 * What the terrain mesh is cut for. Every field is quantised by the controller, so panning or
 * zooming inside the wedge the last mesh was built for leaves the key alone and nothing rebuilds.
 */
export interface MeshWindow extends MeshView {
  rangeM: number;
}

export interface ViewfinderState {
  window: ViewWindow | null;
  meshWindow: MeshWindow | null;
  setWindow(window: ViewWindow | null): void;
  setMeshWindow(meshWindow: MeshWindow | null): void;
}

export const viewfinderStore = create<ViewfinderState>()(
  subscribeWithSelector((set) => ({
    window: null,
    meshWindow: null,
    setWindow: (window) => set({ window }),
    setMeshWindow: (meshWindow) => set({ meshWindow })
  }))
);

export const useViewfinder = viewfinderStore;
