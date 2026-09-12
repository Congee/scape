import { describe, expect, it } from 'vitest';
import { dayBounds } from '@core/time/localDay';
import { makeObserver } from './bodies';
import { dayCurve } from './dayCurve';
import { DEFAULT_MILKY_WAY_OPTIONS, milkyWayStatus, milkyWayWindows, MoonRule } from './milkyWay';

const obs = makeObserver({ lat: 46.02, lng: 7.75 });
const curveFor = (iso: string) => {
  const b = dayBounds(new Date(iso), 'Europe/Zurich');
  return dayCurve(obs, b.start.getTime(), b.end.getTime());
};

describe('Milky Way core windows', () => {
  it('finds a consistent dark window on a June night', () => {
    const curve = curveFor('2026-06-20T12:00:00Z');
    const wins = milkyWayWindows(obs, curve, DEFAULT_MILKY_WAY_OPTIONS);
    expect(wins.length).toBeGreaterThan(0);
    for (const w of wins) {
      expect(w.endMs).toBeGreaterThan(w.startMs + 10 * 60_000);
      expect(milkyWayStatus(obs, (w.startMs + w.endMs) / 2, DEFAULT_MILKY_WAY_OPTIONS).visible).toBe(true);
      if (!w.clippedStart) expect(milkyWayStatus(obs, w.startMs - 120_000, DEFAULT_MILKY_WAY_OPTIONS).visible).toBe(false);
      if (!w.clippedEnd) expect(milkyWayStatus(obs, w.endMs + 120_000, DEFAULT_MILKY_WAY_OPTIONS).visible).toBe(false);
      expect(w.peakAltDeg).toBeGreaterThanOrEqual(DEFAULT_MILKY_WAY_OPTIONS.gcMinAltDeg);
      expect(w.peakMs).toBeGreaterThanOrEqual(w.startMs - curve.stepMs);
      expect(w.peakMs).toBeLessThanOrEqual(w.endMs + curve.stepMs);
    }
  });

  it('ignoring the moon never shortens the windows', () => {
    const curve = curveFor('2026-06-27T12:00:00Z');
    const total = (rule: MoonRule) => milkyWayWindows(obs, curve, { ...DEFAULT_MILKY_WAY_OPTIONS, moonRule: rule }).reduce((s, w) => s + w.endMs - w.startMs, 0);
    expect(total(MoonRule.Ignore)).toBeGreaterThanOrEqual(total(MoonRule.Dim));
    expect(total(MoonRule.Dim)).toBeGreaterThanOrEqual(total(MoonRule.Down));
  });

  it('has no core window in the Alps in December', () => {
    const curve = curveFor('2026-12-20T12:00:00Z');
    expect(milkyWayWindows(obs, curve, { ...DEFAULT_MILKY_WAY_OPTIONS, moonRule: MoonRule.Ignore })).toEqual([]);
  });
});
