import type { KeyboardEvent, ReactNode } from 'react';
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
import { OfflinePanel } from './OfflinePanel';
import { DetailsToggle, TideCloud, Timeline } from './Timeline';
import { WeatherPanel } from './WeatherPanel';
import { PanelTab, uiStore, useUi } from '@state/ui';

const TABS: PanelTab[] = [PanelTab.Plan, PanelTab.Frame, PanelTab.Sky, PanelTab.Weather, PanelTab.Map, PanelTab.Markers];

function Section({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="psec">
      {title && (
        <h2 className="psec-h">
          <span>{title}</span>
          {aside}
        </h2>
      )}
      <div className="psec-b">{children}</div>
    </section>
  );
}

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
  const pick = (t: PanelTab) => {
    ui.setPanelTab(t);
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
          »
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
            <Section>
              <FramePanel />
            </Section>
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
            <Section title="Forecast">
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
            <Section title="Layers">
              <LayersPanel />
            </Section>
            <Section title="Offline">
              <OfflinePanel />
            </Section>
          </>
        )}
        {tab === PanelTab.Markers && (
          <Section>
            <MarkersPanel />
          </Section>
        )}
      </div>
    </div>
  );
}
