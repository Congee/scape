import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const PanelTab = { Timeline: 'Timeline', Geodetics: 'Geodetics', Frame: 'Frame', Night: 'Night', Find: 'Find', Markers: 'Markers', Layers: 'Layers', Offline: 'Offline' } as const;
export type PanelTab = (typeof PanelTab)[keyof typeof PanelTab];

export interface UiState {
  panelTab: PanelTab;
  setPanelTab(tab: PanelTab): void;
  panelCollapsed: boolean;
  setPanelCollapsed(collapsed: boolean): void;
}

export const uiStore = create<UiState>()(
  persist(
    (set) => ({
      panelTab: PanelTab.Timeline,
      setPanelTab: (panelTab) => set({ panelTab }),
      panelCollapsed: false,
      setPanelCollapsed: (panelCollapsed) => set({ panelCollapsed })
    }),
    { name: 'scape.ui', partialize: ({ panelTab, panelCollapsed }) => ({ panelTab, panelCollapsed }) }
  )
);

export const useUi = uiStore;
