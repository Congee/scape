import { describe, expect, it } from 'vitest';
import { migrateUi, PAGE_TABS, PanelPage, PanelTab, tabFor, toPanelTab, uiStore } from './ui';

describe('toPanelTab', () => {
  it('maps the old tabs onto the seven', () => {
    const cases: [string, PanelTab][] = [
      ['Plan', PanelTab.Now],
      ['Timeline', PanelTab.Now],
      ['Geodetics', PanelTab.Now],
      ['Frame', PanelTab.Shot],
      ['Tools', PanelTab.Shot],
      ['Night', PanelTab.Sky],
      ['Find', PanelTab.Find],
      ['Weather', PanelTab.Weather],
      ['Layers', PanelTab.Map],
      ['Offline', PanelTab.Map],
      ['Markers', PanelTab.Markers]
    ];
    for (const [old, tab] of cases) expect(toPanelTab(old)).toBe(tab);
  });

  it('keeps the new names and falls back to Now', () => {
    for (const t of Object.values(PanelTab)) expect(toPanelTab(t)).toBe(t);
    for (const bad of ['', 'toString', 'now', undefined, null, 3]) expect(toPanelTab(bad)).toBe(PanelTab.Now);
  });
});

describe('per-page tabs', () => {
  it('swaps the layers tab for the page and defaults per page', () => {
    expect(tabFor(PanelPage.Viewfinder, PanelTab.Map)).toBe(PanelTab.View);
    expect(tabFor(PanelPage.Map, PanelTab.View)).toBe(PanelTab.Map);
    expect(tabFor(PanelPage.Viewfinder, 'Offline')).toBe(PanelTab.View);
    expect(tabFor(PanelPage.Viewfinder, 'Sky')).toBe(PanelTab.Sky);
    expect(tabFor(PanelPage.Map, undefined)).toBe(PanelTab.Now);
    expect(tabFor(PanelPage.Viewfinder, 'bogus')).toBe(PanelTab.View);
    for (const page of Object.values(PanelPage)) for (const t of Object.values(PanelTab)) expect(PAGE_TABS[page]).toContain(tabFor(page, t));
  });

  it('migrates the one stored tab to the map page', () => {
    expect(migrateUi({ panelTab: 'Night', panelCollapsed: true }, 1)).toEqual({ panelCollapsed: true, panelTabs: { map: PanelTab.Sky, viewfinder: PanelTab.View } });
    expect(migrateUi({ panelTab: 'Layers' }, 0).panelTabs).toEqual({ map: PanelTab.Map, viewfinder: PanelTab.View });
    expect(migrateUi(undefined, 1).panelTabs).toEqual({ map: PanelTab.Now, viewfinder: PanelTab.View });
    expect(migrateUi({ panelTabs: { map: 'Plan', viewfinder: 'Frame' } }, 2).panelTabs).toEqual({ map: PanelTab.Now, viewfinder: PanelTab.Shot });
    expect(migrateUi({ panelTabs: { map: 'View', viewfinder: 'Map' } }, 2).panelTabs).toEqual({ map: PanelTab.Map, viewfinder: PanelTab.View });
    expect(migrateUi({ panelTabs: 'junk' }, 2).panelTabs).toEqual({ map: PanelTab.Now, viewfinder: PanelTab.View });
  });

  it('keeps each page on its own tab', () => {
    const ui = uiStore.getState();
    ui.setPanelPage(PanelPage.Map);
    ui.setPanelTab(PanelTab.Weather);
    ui.setPanelPage(PanelPage.Viewfinder);
    expect(uiStore.getState().panelTab).toBe(PanelTab.View);
    uiStore.getState().setPanelTab(PanelTab.Sky);
    uiStore.getState().setPanelTab(PanelTab.Markers, PanelPage.Map);
    expect(uiStore.getState().panelTab).toBe(PanelTab.Sky);
    uiStore.getState().setPanelPage(PanelPage.Map);
    expect(uiStore.getState().panelTab).toBe(PanelTab.Markers);
    expect(uiStore.getState().panelTabs).toEqual({ map: PanelTab.Markers, viewfinder: PanelTab.Sky });
  });
});
