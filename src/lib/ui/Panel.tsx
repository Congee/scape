import { FramePanel } from './FramePanel';
import { GeodeticsPanel } from './GeodeticsPanel';
import { LayersPanel } from './LayersPanel';
import { LiveReadout } from './LiveReadout';
import { MarkersPanel } from './MarkersPanel';
import { Timeline } from './Timeline';
import { PanelTab, uiStore, useUi } from '@state/ui';

const TABS: PanelTab[] = [PanelTab.Timeline, PanelTab.Geodetics, PanelTab.Frame, PanelTab.Markers, PanelTab.Layers];

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
        {tab === PanelTab.Markers && <MarkersPanel />}
        {tab === PanelTab.Layers && <LayersPanel />}
      </div>
    </div>
  );
}
