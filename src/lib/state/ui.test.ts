import { describe, expect, it } from 'vitest';
import { PanelTab, toPanelTab } from './ui';

describe('toPanelTab', () => {
  it('maps the ten old tabs onto the six', () => {
    const cases: [string, PanelTab][] = [
      ['Timeline', PanelTab.Plan],
      ['Geodetics', PanelTab.Plan],
      ['Frame', PanelTab.Frame],
      ['Tools', PanelTab.Frame],
      ['Night', PanelTab.Sky],
      ['Find', PanelTab.Sky],
      ['Weather', PanelTab.Weather],
      ['Layers', PanelTab.Map],
      ['Offline', PanelTab.Map],
      ['Markers', PanelTab.Markers]
    ];
    for (const [old, tab] of cases) expect(toPanelTab(old)).toBe(tab);
  });

  it('keeps the new names and falls back to Plan', () => {
    for (const t of Object.values(PanelTab)) expect(toPanelTab(t)).toBe(t);
    for (const bad of ['', 'toString', 'plan', undefined, null, 3]) expect(toPanelTab(bad)).toBe(PanelTab.Plan);
  });
});
