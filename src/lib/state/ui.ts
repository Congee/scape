import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const PanelTab = { Timeline: 'Timeline', Geodetics: 'Geodetics', Frame: 'Frame', Night: 'Night', Tools: 'Tools', Find: 'Find', Markers: 'Markers', Layers: 'Layers', Offline: 'Offline' } as const;
export type PanelTab = (typeof PanelTab)[keyof typeof PanelTab];

/** Which list the Markers tab shows. */
export const MarkersView = { Markers: 'Markers', Models: 'Models' } as const;
export type MarkersView = (typeof MarkersView)[keyof typeof MarkersView];

export interface UiState {
  panelTab: PanelTab;
  setPanelTab(tab: PanelTab): void;
  markersView: MarkersView;
  setMarkersView(view: MarkersView): void;
  panelCollapsed: boolean;
  setPanelCollapsed(collapsed: boolean): void;
}

export const uiStore = create<UiState>()(
  persist(
    (set) => ({
      panelTab: PanelTab.Timeline,
      setPanelTab: (panelTab) => set({ panelTab }),
      markersView: MarkersView.Markers,
      setMarkersView: (markersView) => set({ markersView }),
      panelCollapsed: false,
      setPanelCollapsed: (panelCollapsed) => set({ panelCollapsed })
    }),
    { name: 'scape.ui', partialize: ({ panelTab, panelCollapsed, markersView }) => ({ panelTab, panelCollapsed, markersView }) }
  )
);

export const useUi = uiStore;
