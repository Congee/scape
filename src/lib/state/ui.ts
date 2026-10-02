import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const PanelTab = { Plan: 'Plan', Frame: 'Frame', Sky: 'Sky', Weather: 'Weather', Map: 'Map', View: 'View', Markers: 'Markers' } as const;
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

/** The pages that show the panel; each remembers its own tab. */
export const PanelPage = { Map: 'map', Viewfinder: 'viewfinder' } as const;
export type PanelPage = (typeof PanelPage)[keyof typeof PanelPage];

/** Map and View hold the same slot: the page's own layers. */
export const PAGE_TABS: Record<PanelPage, readonly PanelTab[]> = {
  [PanelPage.Map]: [PanelTab.Plan, PanelTab.Frame, PanelTab.Sky, PanelTab.Weather, PanelTab.Map, PanelTab.Markers],
  [PanelPage.Viewfinder]: [PanelTab.Plan, PanelTab.Frame, PanelTab.Sky, PanelTab.Weather, PanelTab.View, PanelTab.Markers]
};

const PAGE_DEFAULT: Record<PanelPage, PanelTab> = { [PanelPage.Map]: PanelTab.Plan, [PanelPage.Viewfinder]: PanelTab.View };

/** A tab name as this page shows it; the other page's layers tab lands on this page's. */
export function tabFor(page: PanelPage, name: unknown): PanelTab {
  const known = typeof name === 'string' && (Object.hasOwn(PanelTab, name) || Object.hasOwn(LEGACY_TAB, name));
  if (!known) return PAGE_DEFAULT[page];
  const t = toPanelTab(name);
  if (t === PanelTab.Map || t === PanelTab.View) return page === PanelPage.Map ? PanelTab.Map : PanelTab.View;
  return t;
}

type PanelTabs = Record<PanelPage, PanelTab>;

function toPanelTabs(raw: unknown): PanelTabs {
  const r = (raw ?? {}) as Partial<Record<PanelPage, unknown>>;
  return { [PanelPage.Map]: tabFor(PanelPage.Map, r[PanelPage.Map]), [PanelPage.Viewfinder]: tabFor(PanelPage.Viewfinder, r[PanelPage.Viewfinder]) };
}

/** Stored ui state from any version; v1 kept one tab, which stays the map page's. */
export function migrateUi(stored: unknown, version: number): Record<string, unknown> {
  const { panelTab, ...rest } = (stored ?? {}) as Record<string, unknown>;
  const panelTabs = version < 2 ? { [PanelPage.Map]: tabFor(PanelPage.Map, panelTab ?? PanelTab.Plan), [PanelPage.Viewfinder]: PanelTab.View } : toPanelTabs(rest.panelTabs);
  return { ...rest, panelTabs };
}

/** Which list the Markers tab shows. */
export const MarkersView = { Markers: 'Markers', Models: 'Models' } as const;
export type MarkersView = (typeof MarkersView)[keyof typeof MarkersView];

/** What the 3D map turns around; Off leaves the view to the user. */
export const OrbitPivot = { Off: 'Off', Target: 'Target', Camera: 'Camera' } as const;
export type OrbitPivot = (typeof OrbitPivot)[keyof typeof OrbitPivot];

export interface UiState {
  /** The page showing the panel now; not stored. */
  panelPage: PanelPage;
  setPanelPage(page: PanelPage): void;
  panelTabs: PanelTabs;
  /** The shown page's tab. */
  panelTab: PanelTab;
  /** Sets a page's tab, the shown page's by default. */
  setPanelTab(tab: PanelTab, page?: PanelPage): void;
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
      panelPage: PanelPage.Map,
      setPanelPage: (panelPage) => set((s) => ({ panelPage, panelTab: s.panelTabs[panelPage] })),
      panelTabs: { ...PAGE_DEFAULT },
      panelTab: PAGE_DEFAULT[PanelPage.Map],
      setPanelTab: (tab, page) =>
        set((s) => {
          const p = page ?? s.panelPage;
          const panelTabs = { ...s.panelTabs, [p]: tabFor(p, tab) };
          return { panelTabs, panelTab: panelTabs[s.panelPage] };
        }),
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
      version: 2,
      partialize: ({ panelTabs, panelCollapsed, markersView, cloudLegendOpen }) => ({ panelTabs, panelCollapsed, markersView, cloudLegendOpen }),
      migrate: (stored, version) => migrateUi(stored, version) as unknown as UiState,
      merge: (stored, current) => {
        const s = { ...current, ...(stored as Partial<UiState>) };
        const panelTabs = toPanelTabs(s.panelTabs);
        return { ...s, panelTabs, panelTab: panelTabs[s.panelPage] };
      }
    }
  )
);

export const useUi = uiStore;
