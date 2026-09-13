import { FindPanel } from './FindPanel';
import { FramePanel } from './FramePanel';
import { GeodeticsPanel } from './GeodeticsPanel';
import { LayersPanel } from './LayersPanel';
import { LiveReadout } from './LiveReadout';
import { MarkersPanel } from './MarkersPanel';
import { NightPanel } from './NightPanel';
import { OfflinePanel } from './OfflinePanel';
import { Timeline } from './Timeline';
import { PanelTab, uiStore, useUi } from '@state/ui';

const TABS: PanelTab[] = [PanelTab.Timeline, PanelTab.Geodetics, PanelTab.Frame, PanelTab.Night, PanelTab.Find, PanelTab.Markers, PanelTab.Layers, PanelTab.Offline];

/** Page roots take this class so the grid drops the panel column. */
export function usePanelClass(base: string): string {
  return useUi((s) => (s.panelCollapsed ? `${base} panel-collapsed` : base));
}

/** Floating handle that brings the collapsed panel back; lives in the map/viewfinder area. */
export function PanelExpand() {
  const collapsed = useUi((s) => s.panelCollapsed);
  if (!collapsed) return null;
  return (
    <button className="panel-expand" title="Show panel" aria-label="Show panel" onClick={() => uiStore.getState().setPanelCollapsed(false)}>
      «
    </button>
  );
}

export function Panel() {
  const tab = useUi((s) => s.panelTab);
  return (
    <div className="panel-inner">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => uiStore.getState().setPanelTab(t)}>
            {t}
          </button>
        ))}
        <button className="tabs-collapse" title="Hide panel" aria-label="Hide panel" onClick={() => uiStore.getState().setPanelCollapsed(true)}>
          »
        </button>
      </div>
      <div className="tab-body">
        {tab === PanelTab.Timeline && (
          <>
            <LiveReadout />
            <Timeline />
          </>
        )}
        {tab === PanelTab.Geodetics && <GeodeticsPanel />}
        {tab === PanelTab.Frame && <FramePanel />}
        {tab === PanelTab.Night && <NightPanel />}
        {tab === PanelTab.Find && <FindPanel />}
        {tab === PanelTab.Markers && <MarkersPanel />}
        {tab === PanelTab.Layers && <LayersPanel />}
        {tab === PanelTab.Offline && <OfflinePanel />}
      </div>
    </div>
  );
}
