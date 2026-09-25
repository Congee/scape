import { describe, expect, it } from 'vitest';
import { dayBounds } from '@core/time/localDay';
import { makeObserver } from './bodies';
import { dayCurve } from './dayCurve';
import { lunarTotality } from './eclipse';
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

describe('Milky Way under an eclipsed moon', () => {
  // 2025-09-07 from Nairobi: the full moon and the core are both high during totality.
  const nairobi = makeObserver({ lat: -1.29, lng: 36.82 });
  const dim = { ...DEFAULT_MILKY_WAY_OPTIONS, moonRule: MoonRule.Dim };
  const b = dayBounds(new Date('2025-09-07T12:00:00Z'), 'Africa/Nairobi');
  const curve = dayCurve(nairobi, b.start.getTime(), b.end.getTime());
  const totality = lunarTotality(b.start.getTime(), b.end.getTime())!;
  const mid = (totality.startMs + totality.endMs) / 2;

  it('passes the Dim rule during totality and fails it once the moon is full again', () => {
    const s = milkyWayStatus(nairobi, mid, dim);
    expect(s.moonAltDeg).toBeGreaterThan(10);
    expect(s.moonIllumination).toBeGreaterThan(0.9);
    expect(s.visible).toBe(true);
    expect(milkyWayStatus(nairobi, totality.endMs + 90 * 60_000, dim).moonOk).toBe(false);
    expect(milkyWayStatus(nairobi, mid, DEFAULT_MILKY_WAY_OPTIONS).moonOk).toBe(false);
  });

  it('has a Dim window around totality with consistent boundaries', () => {
    const w = milkyWayWindows(nairobi, curve, dim).find((x) => x.startMs <= mid && x.endMs >= mid)!;
    expect(w.startMs).toBeLessThanOrEqual(totality.startMs);
    expect(w.endMs).toBeGreaterThanOrEqual(totality.endMs);
    if (!w.clippedStart) expect(milkyWayStatus(nairobi, w.startMs - 60_000, dim).visible).toBe(false);
    if (!w.clippedEnd) expect(milkyWayStatus(nairobi, w.endMs + 60_000, dim).visible).toBe(false);
    expect(milkyWayWindows(nairobi, curve, DEFAULT_MILKY_WAY_OPTIONS).some((x) => x.startMs <= mid && x.endMs >= mid)).toBe(false);
  });
});
