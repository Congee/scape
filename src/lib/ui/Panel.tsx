import { useLayoutEffect, type KeyboardEvent } from 'react';
import { FindPanel } from './FindPanel';
import { FramePanel } from './FramePanel';
import { GeodeticsPanel } from './GeodeticsPanel';
import { LayersPanel } from './LayersPanel';
import { LiveReadout } from './LiveReadout';
import { MarkersPanel } from './MarkersPanel';
import { NightPanel } from './NightPanel';
import { ParkingLinks } from './ParkingLinks';
import { DayStrip, PlaceBand } from './PlanHeader';
import { ToolsPanel, ToolsPart } from './ToolsPanel';
import { OfflineRow } from './OfflinePanel';
import { DetailsToggle, TideCloud, Timeline } from './Timeline';
import { WeatherPanel } from './WeatherPanel';
import { PAGE_TABS, PanelPage, PanelTab, uiStore, useUi } from '@state/ui';
import { Icon } from './Icon';
import { PanelPageContext } from './panelPage';
import { Section } from './Section';
import { ViewTools } from './viewfinder/ViewTools';

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
      <Icon name="left" />
    </button>
  );
}

export function Panel({ page = PanelPage.Map }: { page?: PanelPage }) {
  const TABS = PAGE_TABS[page];
  const tab = useUi((s) => s.panelTabs[page]);
  // Outside callers (badges, links) then switch this page's tab.
  useLayoutEffect(() => uiStore.getState().setPanelPage(page), [page]);
  const collapsed = useUi((s) => s.panelCollapsed);
  const ui = uiStore.getState();
  const pick = (t: PanelTab) => {
    ui.setPanelTab(t, page);
    // On narrow screens the tab row stays as a peek bar; a tap opens the sheet.
    ui.setPanelCollapsed(false);
  };
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const next = e.key === 'ArrowRight' ? TABS[(i + 1) % TABS.length] : e.key === 'ArrowLeft' ? TABS[(i + TABS.length - 1) % TABS.length] : e.key === 'Home' ? TABS[0] : e.key === 'End' ? TABS[TABS.length - 1] : null;
    if (!next) return;
    e.preventDefault();
    pick(next);
    document.getElementById(`ptab-${next}`)?.focus();
  };
  return (
    <PanelPageContext.Provider value={page}>
      <div className="panel-inner">
        <PlaceBand />
        <div className="tabs">
          <div className="tablist" role="tablist" aria-label="Panel" onKeyDown={onKey}>
            {TABS.map((t) => (
              <button key={t} id={`ptab-${t}`} role="tab" aria-selected={tab === t} aria-controls="ptabpanel" tabIndex={tab === t ? 0 : -1} className={tab === t ? 'active' : ''} onClick={() => pick(t)}>
                {t}
              </button>
            ))}
          </div>
          <button className="tabs-collapse" title={collapsed ? 'Show panel' : 'Hide panel'} aria-label={collapsed ? 'Show panel' : 'Hide panel'} onClick={() => ui.setPanelCollapsed(!collapsed)}>
            <Icon name="right" />
          </button>
        </div>
        <div className="tab-body" id="ptabpanel" role="tabpanel" aria-labelledby={`ptab-${tab}`}>
          {tab === PanelTab.Plan && (
            <>
              <DayStrip />
              <Section title="Now">
                <LiveReadout />
                <ParkingLinks />
              </Section>
              <Section title="Today" aside={<DetailsToggle />}>
                <Timeline />
              </Section>
              <Section title="Target">
                <GeodeticsPanel />
              </Section>
            </>
          )}
          {tab === PanelTab.Frame && (
            <>
              <FramePanel />
              <Section title="Calculators">
                <ToolsPanel part={ToolsPart.Frame} />
              </Section>
            </>
          )}
          {tab === PanelTab.Sky && (
            <>
              <Section title="Night">
                <NightPanel />
              </Section>
              <Section title="Find">
                <FindPanel />
              </Section>
              <Section title="Moon & light">
                <ToolsPanel part={ToolsPart.Sky} />
              </Section>
            </>
          )}
          {tab === PanelTab.Weather && (
            <>
              <Section>
                <WeatherPanel />
              </Section>
              <Section title="Tide & cloud">
                <TideCloud />
              </Section>
              <Section title="Calculators">
                <ToolsPanel part={ToolsPart.Weather} />
              </Section>
            </>
          )}
          {tab === PanelTab.Map && (
            <>
              <LayersPanel />
              <OfflineRow />
            </>
          )}
          {tab === PanelTab.View && <ViewTools />}
          {tab === PanelTab.Markers && <MarkersPanel />}
        </div>
      </div>
    </PanelPageContext.Provider>
  );
}
