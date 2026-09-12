import { create } from 'zustand';

export const PanelTab = { Timeline: 'Timeline', Geodetics: 'Geodetics', Frame: 'Frame', Markers: 'Markers', Layers: 'Layers' } as const;
export type PanelTab = (typeof PanelTab)[keyof typeof PanelTab];

export interface UiState {
  panelTab: PanelTab;
  setPanelTab(tab: PanelTab): void;
}

export const uiStore = create<UiState>()((set) => ({
  panelTab: PanelTab.Timeline,
  setPanelTab: (panelTab) => set({ panelTab })
}));

export const useUi = uiStore;
