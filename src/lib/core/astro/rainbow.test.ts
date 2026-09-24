import { describe, expect, it } from 'vitest';
import { arcWindow, PRIMARY_DEG, rainbowArc, rainbowRadiusDeg, rainbowTop, SECONDARY_DEG, WATER_N } from './rainbow';

const sep = (a: { azimuthDeg: number; altitudeDeg: number }, b: { azimuthDeg: number; altitudeDeg: number }) => {
  const r = Math.PI / 180;
  const c = Math.sin(a.altitudeDeg * r) * Math.sin(b.altitudeDeg * r) + Math.cos(a.altitudeDeg * r) * Math.cos(b.altitudeDeg * r) * Math.cos((a.azimuthDeg - b.azimuthDeg) * r);
  return Math.acos(Math.min(1, c)) / r;
};

describe('rainbow geometry', () => {
  it('HyperPhysics "Rainbow" (Descartes ray): primary about 42.4° red to 40.6° violet', () => {
    expect(rainbowRadiusDeg(WATER_N.Red, 1)).toBeCloseTo(42.35, 1);
    expect(rainbowRadiusDeg(WATER_N.Violet, 1)).toBeCloseTo(40.6, 1);
  });

  it('HyperPhysics "Rainbow": secondary 50.4° red to 53.6° violet, colours reversed', () => {
    expect(rainbowRadiusDeg(WATER_N.Red, 2)).toBeCloseTo(50.4, 1);
    expect(rainbowRadiusDeg(WATER_N.Violet, 2)).toBeCloseTo(53.6, 1);
    expect(PRIMARY_DEG).toBeCloseTo(42, 0);
    expect(SECONDARY_DEG).toBeCloseTo(51, 0);
  });

  it('Minnaert, Light and Colour in the Outdoors: the top stands at 42° − sun altitude opposite the sun', () => {
    const top = rainbowTop(250, 12);
    expect(top.azimuthDeg).toBeCloseTo(70, 9);
    expect(top.altitudeDeg).toBeCloseTo(PRIMARY_DEG - 12, 9);
    expect(top.possible).toBe(true);
    expect(rainbowTop(250, 1e-6).halfSpanDeg).toBeCloseTo(PRIMARY_DEG, 4);
  });

  it('no primary bow with the sun above 42° or below the horizon', () => {
    expect(rainbowTop(180, 45).possible).toBe(false);
    expect(rainbowTop(180, -1).possible).toBe(false);
    expect(rainbowTop(180, 45, SECONDARY_DEG).possible).toBe(true);
  });

  it('arc points lie on the circle, above the horizon, through the top', () => {
    const pts = rainbowArc(250, 12, PRIMARY_DEG);
    const anti = { azimuthDeg: 70, altitudeDeg: -12 };
    for (const p of pts) {
      expect(sep(p, anti)).toBeCloseTo(PRIMARY_DEG, 6);
      expect(p.altitudeDeg).toBeGreaterThanOrEqual(0);
    }
    expect(Math.max(...pts.map((p) => p.altitudeDeg))).toBeCloseTo(PRIMARY_DEG - 12, 2);
    expect(rainbowArc(180, 60, PRIMARY_DEG)).toEqual([]);
  });

  it('a narrow view window samples only the part of the bow near the view', () => {
    const win = arcWindow(250, 12, PRIMARY_DEG, 70, PRIMARY_DEG - 12, 0.5);
    expect(win).not.toBeNull();
    const pts = rainbowArc(250, 12, PRIMARY_DEG, 0, 20, win!);
    for (const p of pts) expect(sep(p, { azimuthDeg: 70, altitudeDeg: PRIMARY_DEG - 12 })).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(arcWindow(250, 12, PRIMARY_DEG, 70, 5, 0.5)).toBeNull();
    expect(arcWindow(250, 12, PRIMARY_DEG, 70, -12, 50)).toEqual([-Math.PI, Math.PI]);
  });
});
