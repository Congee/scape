import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const PanelTab = { Plan: 'Plan', Frame: 'Frame', Sky: 'Sky', Weather: 'Weather', Map: 'Map', Markers: 'Markers' } as const;
export type PanelTab = (typeof PanelTab)[keyof typeof PanelTab];

/** The ten tabs before the regroup, so stored or scripted names still land somewhere. */
const LEGACY_TAB: Record<string, PanelTab> = {
  Timeline: PanelTab.Plan,
  Geodetics: PanelTab.Plan,
  Tools: PanelTab.Frame,
  Night: PanelTab.Sky,
  Find: PanelTab.Sky,
  Layers: PanelTab.Map,
  Offline: PanelTab.Map
};

export function toPanelTab(name: unknown): PanelTab {
  if (typeof name !== 'string') return PanelTab.Plan;
  if (Object.hasOwn(PanelTab, name)) return name as PanelTab;
  return Object.hasOwn(LEGACY_TAB, name) ? LEGACY_TAB[name] : PanelTab.Plan;
}

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
  /** The phone's cloud legend is folded to one line until opened. */
  cloudLegendOpen: boolean;
  setCloudLegendOpen(open: boolean): void;
}

export const uiStore = create<UiState>()(
  persist(
    (set) => ({
      panelTab: PanelTab.Plan,
      setPanelTab: (tab) => set({ panelTab: toPanelTab(tab) }),
      markersView: MarkersView.Markers,
      setMarkersView: (markersView) => set({ markersView }),
      panelCollapsed: false,
      setPanelCollapsed: (panelCollapsed) => set({ panelCollapsed }),
      orbit: OrbitPivot.Off,
      orbitSpin: true,
      setOrbit: (orbit, spin) => set((s) => ({ orbit, orbitSpin: spin ?? s.orbitSpin })),
      cloudLegendOpen: false,
      setCloudLegendOpen: (cloudLegendOpen) => set({ cloudLegendOpen })
    }),
    {
      name: 'scape.ui',
      version: 1,
      partialize: ({ panelTab, panelCollapsed, markersView, cloudLegendOpen }) => ({ panelTab, panelCollapsed, markersView, cloudLegendOpen }),
      migrate: (stored) => {
        const s = (stored ?? {}) as Partial<UiState>;
        return { ...s, panelTab: toPanelTab(s.panelTab) } as UiState;
      }
    }
  )
);

export const useUi = uiStore;
