import { describe, expect, it } from 'vitest';
import { borderRects, fitFrame, fitViewports } from './frameFit';

const FF = { w: 36, h: 24 };
const centre = (x: number, w: number) => x + w / 2;

describe('fitFrame', () => {
  it('fills the height of a wide area with a landscape sensor, centred', () => {
    const { frame, area } = fitFrame(1440, 830, FF.w, FF.h);
    expect(area).toEqual({ x: 8, y: 8, w: 1424, h: 800 });
    expect(frame.h).toBeCloseTo(800);
    expect(frame.w).toBeCloseTo(1200);
    expect(frame.pxPerMm).toBeCloseTo(800 / 24);
    expect(centre(frame.x, frame.w)).toBeCloseTo(centre(area.x, area.w));
  });

  it('fills the width of a tall area with a portrait sensor, centred', () => {
    const { frame, area } = fitFrame(390, 800, FF.h, FF.w);
    expect(frame.w).toBeCloseTo(374);
    expect(frame.h).toBeCloseTo(561);
    expect(centre(frame.y, frame.h)).toBeCloseTo(centre(area.y, area.h));
  });
});

describe('fitViewports', () => {
  it('extends a landscape frame sideways in a wide window, bordered left and right', () => {
    const vp = fitViewports(fitFrame(1440, 830, FF.w, FF.h), 830, 1);
    expect(vp.frame).toEqual({ x: 120, y: 22, w: 1200, h: 800 });
    expect(vp.padX).toBe(112);
    expect(vp.padY).toBe(0);
    expect(vp.area).toEqual({ x: 8, y: 22, w: 1424, h: 800 });
    expect(borderRects(vp, 830, 1)).toEqual([
      { x: 119, y: 8, w: 1, h: 800 },
      { x: 1320, y: 8, w: 1, h: 800 }
    ]);
  });

  it('extends a landscape frame up and down in a tall window', () => {
    const vp = fitViewports(fitFrame(736, 830, FF.w, FF.h), 830, 1);
    expect(vp.padX).toBe(0);
    expect(vp.padY).toBe(160);
    expect(vp.area.h).toBe(800);
    expect(borderRects(vp, 830, 1)).toEqual([
      { x: 8, y: 167, w: 720, h: 1 },
      { x: 8, y: 648, w: 720, h: 1 }
    ]);
  });

  it('extends a portrait frame sideways in a wide window, with DPR-thick bars', () => {
    const vp = fitViewports(fitFrame(1440, 830, FF.h, FF.w), 1660, 2);
    expect(vp.padY).toBe(0);
    expect(vp.frame.h).toBe(1600);
    expect(vp.frame.w).toBe(1067);
    expect(centre(vp.area.x, vp.area.w)).toBe(centre(vp.frame.x, vp.frame.w));
    const bars = borderRects(vp, 1660, 2);
    expect(bars.map((r) => r.w)).toEqual([2, 2]);
    expect(bars[0].x + bars[0].w).toBe(vp.frame.x);
    expect(bars[1].x).toBe(vp.frame.x + vp.frame.w);
  });

  it('extends a portrait frame up and down in a tall phone window', () => {
    const vp = fitViewports(fitFrame(390, 800, FF.h, FF.w), 1600, 2);
    expect(vp.padX).toBe(0);
    expect(vp.padY).toBeGreaterThan(0);
    expect(centre(vp.area.y, vp.area.h)).toBe(centre(vp.frame.y, vp.frame.h));
    expect(borderRects(vp, 1600, 2).map((r) => r.h)).toEqual([2, 2]);
  });

  it('draws no border and no extension on an exact fit', () => {
    const fit = fitFrame(1216, 830, FF.w, FF.h);
    for (const dpr of [1, 1.25, 2]) {
      const vp = fitViewports(fit, Math.round(830 * dpr), dpr);
      expect(vp.padX).toBe(0);
      expect(vp.padY).toBe(0);
      expect(vp.area).toEqual(vp.frame);
      expect(borderRects(vp, Math.round(830 * dpr), dpr)).toEqual([]);
    }
  });

  it('borders all four sides, corners included, when the area reaches past both axes', () => {
    const vp = { frame: { x: 100, y: 100, w: 200, h: 100 }, area: { x: 90, y: 80, w: 220, h: 140 }, padX: 10, padY: 20 };
    expect(borderRects(vp, 400, 1)).toEqual([
      { x: 100, y: 199, w: 200, h: 1 },
      { x: 100, y: 300, w: 200, h: 1 },
      { x: 99, y: 199, w: 1, h: 102 },
      { x: 300, y: 199, w: 1, h: 102 }
    ]);
  });
});
