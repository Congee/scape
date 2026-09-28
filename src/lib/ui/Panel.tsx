import { FindPanel } from './FindPanel';
import { FramePanel } from './FramePanel';
import { GeodeticsPanel } from './GeodeticsPanel';
import { LayersPanel } from './LayersPanel';
import { LiveReadout } from './LiveReadout';
import { MarkersPanel } from './MarkersPanel';
import { NightPanel } from './NightPanel';
import { ParkingLinks } from './ParkingLinks';
import { ToolsPanel } from './ToolsPanel';
import { OfflinePanel } from './OfflinePanel';
import { Timeline } from './Timeline';
import { WeatherPanel } from './WeatherPanel';
import { PanelTab, uiStore, useUi } from '@state/ui';

const TABS: PanelTab[] = [PanelTab.Timeline, PanelTab.Geodetics, PanelTab.Frame, PanelTab.Night, PanelTab.Tools, PanelTab.Weather, PanelTab.Find, PanelTab.Markers, PanelTab.Layers, PanelTab.Offline];

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
  const collapsed = useUi((s) => s.panelCollapsed);
  const ui = uiStore.getState();
  return (
    <div className="panel-inner">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'active' : ''}
            onClick={() => {
              ui.setPanelTab(t);
              // On narrow screens the tab row stays as a peek bar; a tap opens the sheet.
              ui.setPanelCollapsed(false);
            }}
          >
            {t}
          </button>
        ))}
        <button className="tabs-collapse" title={collapsed ? 'Show panel' : 'Hide panel'} aria-label={collapsed ? 'Show panel' : 'Hide panel'} onClick={() => ui.setPanelCollapsed(!collapsed)}>
          »
        </button>
      </div>
      <div className="tab-body">
        {tab === PanelTab.Timeline && (
          <>
            <LiveReadout />
            <ParkingLinks />
            <Timeline />
          </>
        )}
        {tab === PanelTab.Geodetics && <GeodeticsPanel />}
        {tab === PanelTab.Frame && <FramePanel />}
        {tab === PanelTab.Night && <NightPanel />}
        {tab === PanelTab.Tools && <ToolsPanel />}
        {tab === PanelTab.Weather && <WeatherPanel />}
        {tab === PanelTab.Find && <FindPanel />}
        {tab === PanelTab.Markers && <MarkersPanel />}
        {tab === PanelTab.Layers && <LayersPanel />}
        {tab === PanelTab.Offline && <OfflinePanel />}
      </div>
    </div>
  );
}
