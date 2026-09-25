import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const PanelTab = { Timeline: 'Timeline', Geodetics: 'Geodetics', Frame: 'Frame', Night: 'Night', Tools: 'Tools', Find: 'Find', Markers: 'Markers', Layers: 'Layers', Offline: 'Offline', Weather: 'Weather' } as const;
export type PanelTab = (typeof PanelTab)[keyof typeof PanelTab];

/** Which list the Markers tab shows. */
export const MarkersView = { Markers: 'Markers', Models: 'Models' } as const;
export type MarkersView = (typeof MarkersView)[keyof typeof MarkersView];

/** What the 3D map turns around; Off leaves the view to the user. */
export const OrbitPivot = { Off: 'Off', Target: 'Target', Camera: 'Camera' } as const;
export type OrbitPivot = (typeof OrbitPivot)[keyof typeof OrbitPivot];

export interface UiState {
  panelTab: PanelTab;
  setPanelTab(tab: PanelTab): void;
  markersView: MarkersView;
  setMarkersView(view: MarkersView): void;
  panelCollapsed: boolean;
  setPanelCollapsed(collapsed: boolean): void;
  orbit: OrbitPivot;
  /** The orbit turns by itself until the user grabs the map. */
  orbitSpin: boolean;
  setOrbit(orbit: OrbitPivot, spin?: boolean): void;
}

export const uiStore = create<UiState>()(
  persist(
    (set) => ({
      panelTab: PanelTab.Timeline,
      setPanelTab: (panelTab) => set({ panelTab }),
      markersView: MarkersView.Markers,
      setMarkersView: (markersView) => set({ markersView }),
      panelCollapsed: false,
      setPanelCollapsed: (panelCollapsed) => set({ panelCollapsed }),
      orbit: OrbitPivot.Off,
      orbitSpin: true,
      setOrbit: (orbit, spin) => set((s) => ({ orbit, orbitSpin: spin ?? s.orbitSpin }))
    }),
    { name: 'scape.ui', partialize: ({ panelTab, panelCollapsed, markersView }) => ({ panelTab, panelCollapsed, markersView }) }
  )
);

export const useUi = uiStore;
