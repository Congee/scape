import { describe, expect, it } from 'vitest';
import { bilinear, cellPoints, lattice, latticeCorners, latticeStep, MAX_CELLS, paintLattice } from './grid';
import { CloudLayer, gapColor, layerColor, layerValue, legendGradient, MIST_MAX } from './layer';
import { HourlyVar, type PointSeries } from './openMeteo';

const rotterdam = { west: 4.2, south: 51.8, east: 4.8, north: 52.05 };

describe('latticeStep', () => {
  it('doubles from 0.01° until the viewport fits', () => {
    const s = latticeStep(rotterdam, 0);
    expect(0.6 / s).toBeLessThanOrEqual(MAX_CELLS);
    expect(0.6 / (s / 2)).toBeGreaterThan(MAX_CELLS);
    expect(Math.log2(s / 0.01) % 1).toBeCloseTo(0, 9);
  });

  it('is never finer than the model grid', () => {
    expect(latticeStep({ west: 4.47, south: 51.92, east: 4.48, north: 51.93 }, 9) * 111.2).toBeGreaterThanOrEqual(9);
  });
});

describe('lattice', () => {
  it('covers the viewport with a spare ring on shared multiples', () => {
    const l = lattice(rotterdam, 0);
    expect(l.lng0).toBeLessThan(rotterdam.west - l.step / 2);
    expect(l.lng0 + (l.cols - 1) * l.step).toBeGreaterThan(rotterdam.east);
    expect(l.lat0 + (l.rows - 1) * l.step).toBeGreaterThan(rotterdam.north);
    expect((l.lng0 / l.step) % 1).toBeCloseTo(0, 9);
    expect(cellPoints(l)).toHaveLength(l.cols * l.rows);
  });

  it('wraps longitude and clamps latitude', () => {
    const l = lattice({ west: 170, south: 80, east: 190, north: 89 }, 0);
    expect(Math.max(...cellPoints(l).map((p) => p.lng))).toBeLessThan(180);
    expect(latticeCorners(l)[0][1]).toBeLessThanOrEqual(85);
  });
});

describe('bilinear', () => {
  const v = [0, 100, 50, NaN];
  it('interpolates and hits corners exactly', () => {
    expect(bilinear([0, 100, 0, 100], 2, 2, 0.25, 0.5)).toBeCloseTo(25, 9);
    expect(bilinear(v, 2, 2, 1, 0)).toBe(100);
  });
  it('is unknown near a missing corner', () => {
    expect(bilinear(v, 2, 2, 0.5, 0.5)).toBeNaN();
    expect(bilinear(v, 2, 2, 0.5, 0)).toBe(50);
  });
});

describe('paintLattice', () => {
  it('hatches gaps, fades cover by value, premultiplied', () => {
    const l = { step: 1, lat0: 0, lng0: 0, cols: 2, rows: 1 };
    const img = paintLattice(l, [100, NaN], 4, (x) => layerColor(CloudLayer.Total, x), gapColor);
    expect(img.width).toBe(8);
    expect(img.data[3]).toBeGreaterThan(200);
    const last = (img.width - 1) * 4;
    expect(img.data[last + 3]).toBeGreaterThan(0);
    const a = img.data[last + 3] / 255;
    expect(img.data[last] / a).toBeCloseTo(200, -1);
  });
});

const s = (vals: Partial<Record<HourlyVar, number>>): PointSeries => ({
  lat: 0,
  lng: 0,
  startMs: 0,
  hours: 1,
  values: Object.fromEntries(Object.entries(vals).map(([k, x]) => [k, Float32Array.of(x)]))
});

describe('layerValue', () => {
  it('reads cover per layer', () => {
    expect(layerValue(CloudLayer.Low, s({ cloud_cover_low: 40 }), 0)).toBe(40);
    expect(layerValue(CloudLayer.High, s({ cloud_cover_low: 40 }), 0)).toBeNaN();
  });
  it('bands visibility into mist and fog, and flags fog codes', () => {
    expect(layerValue(CloudLayer.Fog, s({ weather_code: 45, visibility: 20000 }), 0)).toBe(1);
    expect(layerValue(CloudLayer.Fog, s({ weather_code: 3, visibility: 20000 }), 0)).toBe(0);
    expect(layerValue(CloudLayer.Fog, s({ visibility: 5000 }), 0)).toBe(0);
    expect(layerValue(CloudLayer.Fog, s({ visibility: 3000 }), 0)).toBeCloseTo(MIST_MAX / 2, 5);
    expect(layerValue(CloudLayer.Fog, s({ visibility: 1000 }), 0)).toBe(MIST_MAX);
    expect(layerValue(CloudLayer.Fog, s({ visibility: 999 }), 0)).toBe(1);
    expect(layerValue(CloudLayer.Fog, s({ weather_code: 3 }), 0)).toBeNaN();
    expect(layerValue(CloudLayer.Fog, null, 0)).toBeNaN();
  });
});

const alpha = (v: number) => layerColor(CloudLayer.Fog, v)[3];

describe('layerColor Fog', () => {
  it('leaves clear air transparent, shades mist lightly and fog at full strength', () => {
    expect(alpha(0)).toBe(0);
    expect(alpha(0.01)).toBeGreaterThan(0);
    expect(alpha(MIST_MAX / 2)).toBeLessThan(alpha(MIST_MAX));
    expect(alpha(MIST_MAX)).toBeLessThan(alpha(1) / 2);
    expect(alpha(1)).toBe(0.85);
  });
  it('shows the mist ramp and a solid fog step in the legend', () => {
    const g = legendGradient(CloudLayer.Fog);
    expect(g).toContain('rgba(0,0,0,0.00) 0%');
    expect(g).toContain('rgba(232,197,71,0.85) 65%');
  });
});
