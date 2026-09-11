import { describe, expect, it } from 'vitest';
import { curvatureDropM, elevationAngleDeg } from '@core/geo/geodesy';
import { analyzeSightline, flatHorizonDeg } from './los';

const line = (n: number, totalM: number) => Float32Array.from({ length: n }, (_, i) => (totalM * i) / (n - 1));

describe('analyzeSightline', () => {
  it('sees a 30 m target across flat ground; the ground past the sea horizon is hidden', () => {
    const r = analyzeSightline(line(101, 10_000), new Float32Array(101), 1.6, 30);
    expect(r.status).toBe('clear');
    expect(r.targetAngleDeg).toBeCloseTo(0.124, 2);
    expect(r.maxTerrainAngleDeg).toBeCloseTo(-0.038, 2);
    expect(r.visible[40]).toBe(1);
    expect(r.visible[99]).toBe(0);
    expect(r.visible[100]).toBe(1);
  });

  it('hides two eye-level observers 10 km apart behind the curvature', () => {
    expect(analyzeSightline(line(101, 10_000), new Float32Array(101), 1.6, 1.6).status).toBe('blocked');
  });

  it('is blocked by a ridge and hides the ground behind it', () => {
    const g = new Float32Array(101);
    g[50] = 200;
    const r = analyzeSightline(line(101, 10_000), g, 1.6, 1.6);
    expect(r.status).toBe('blocked');
    expect(r.maxTerrainAngleDeg).toBeCloseTo(elevationAngleDeg(5000, 200 - 1.6), 6);
    expect(r.minClearanceM).toBeLessThan(0);
    expect(r.minClearanceAtM).toBe(5000);
    expect(r.visible[50]).toBe(1);
    expect(r.visible[51]).toBe(0);
    expect(r.visible[100]).toBe(0);
  });

  it('reports marginal when the target barely clears', () => {
    const g = new Float32Array(101);
    g[50] = 100;
    const ridge = elevationAngleDeg(5000, 100 - 1.6);
    const targetM = 1.6 + Math.tan(((ridge + 0.05) * Math.PI) / 180) * 10_000 + curvatureDropM(10_000);
    const r = analyzeSightline(line(101, 10_000), g, 1.6, targetM);
    expect(r.status).toBe('marginal');
    expect(r.marginDeg).toBeCloseTo(0.05, 3);
  });

  it('ignores obstacles inside the pins\' own cells', () => {
    const g = new Float32Array(101);
    g[1] = 50;
    g[99] = 50;
    expect(analyzeSightline(line(101, 10_000), g, 1.6, 30).status).toBe('blocked');
    expect(analyzeSightline(line(101, 10_000), g, 1.6, 30, 150).status).toBe('clear');
  });

  it('never lets unknown samples block', () => {
    const g = new Float32Array(101);
    g[50] = NaN;
    expect(analyzeSightline(line(101, 10_000), g, 1.6, 30).status).toBe('clear');
  });
});

describe('flatHorizonDeg', () => {
  it('dips about 0.04° at eye level and not at all on the surface', () => {
    expect(flatHorizonDeg(1.6)).toBeCloseTo(-0.038, 2);
    expect(flatHorizonDeg(0)).toBeCloseTo(0, 9);
  });
});
