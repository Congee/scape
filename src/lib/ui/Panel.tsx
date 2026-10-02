import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { AimControl } from './AimControl';
import { FindPanel } from './FindPanel';
import { FramePanel } from './FramePanel';
import { GeodeticsPanel } from './GeodeticsPanel';
import { LayersPanel } from './LayersPanel';
import { LiveReadout } from './LiveReadout';
import { MarkersPanel } from './MarkersPanel';
import { NightPanel } from './NightPanel';
import { ParkingLinks } from './ParkingLinks';
import { PlaceBand } from './PlanHeader';
import { ToolsPanel, ToolsPart } from './ToolsPanel';
import { OfflineRow } from './OfflinePanel';
import { CloudLine, DetailsToggle, TideLine, Timeline } from './Timeline';
import { WeatherPanel } from './WeatherPanel';
import { PAGE_TABS, PanelPage, PanelTab, uiStore, useUi } from '@state/ui';
import { Icon } from './Icon';
import { PanelPageContext } from './panelPage';
import { Section } from './Section';
import { ViewTools } from './viewfinder/ViewTools';

/** Page roots take this class so the grid drops the panel column. */
export function usePanelClass(base: string): string {
  return useUi((s) => (s.panelCollapsed ? `${base} panel-collapsed` : s.panelTall ? `${base} panel-tall` : base));
}

/** Steps the phone sheet between peek, open and tall. */
export function stepSheet(up: boolean) {
  const s = uiStore.getState();
  if (up) {
    if (s.panelCollapsed) s.setPanelCollapsed(false);
    else s.setPanelTall(true);
  } else if (s.panelTall && !s.panelCollapsed) s.setPanelTall(false);
  else s.setPanelCollapsed(true);
}

const DRAG_PX = 24;

/** The phone sheet's grab handle: drag or arrow keys step it, a tap toggles tall. */
function SheetHandle() {
  const tall = useUi((s) => s.panelTall && !s.panelCollapsed);
  const from = useRef<number | null>(null);
  const dragged = useRef(false);
  return (
    <button
      className="sheet-handle"
      aria-label={tall ? 'Shrink panel' : 'Expand panel'}
      title={tall ? 'Shrink panel' : 'Expand panel'}
      onPointerDown={(e) => {
        from.current = e.clientY;
        dragged.current = false;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerUp={(e) => {
        const dy = from.current === null ? 0 : e.clientY - from.current;
        from.current = null;
        if (Math.abs(dy) < DRAG_PX) return;
        dragged.current = true;
        stepSheet(dy < 0);
      }}
      onPointerCancel={() => (from.current = null)}
      onClick={() => {
        // A drag already stepped the sheet; its trailing click must not undo that.
        if (dragged.current) return void (dragged.current = false);
        const s = uiStore.getState();
        if (s.panelCollapsed) s.setPanelCollapsed(false);
        else s.setPanelTall(!s.panelTall);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        stepSheet(e.key === 'ArrowUp');
      }}
    />
  );
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
        <SheetHandle />
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
          {tab === PanelTab.Now && (
            <>
              {/* The viewfinder's BodyStrip is its live readout. */}
              {page === PanelPage.Map && (
                <Section title="Now">
                  <LiveReadout />
                  <ParkingLinks />
                </Section>
              )}
              <Section title="Aim">
                <AimControl />
              </Section>
              <Section title="Today" aside={<DetailsToggle />}>
                <Timeline />
              </Section>
              <Section title="Target">
                <GeodeticsPanel />
                {page !== PanelPage.Map && <ParkingLinks />}
              </Section>
            </>
          )}
          {tab === PanelTab.Shot && <FramePanel />}
          {tab === PanelTab.Sky && (
            <>
              <Section title="Night">
                <NightPanel />
              </Section>
              <Section title="Moon & light">
                <ToolsPanel part={ToolsPart.Sky} />
              </Section>
            </>
          )}
          {tab === PanelTab.Find && (
            <Section>
              <FindPanel />
            </Section>
          )}
          {tab === PanelTab.Weather && (
            <>
              <Section title="Forecast">
                <WeatherPanel>
                  <CloudLine />
                </WeatherPanel>
              </Section>
              <Section title="Tide, rainbow, clouds">
                <TideLine />
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
