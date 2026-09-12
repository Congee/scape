import { describe, expect, it } from 'vitest';
import { HeatMode } from '@workers/align.protocol';
import { heatColor, type HeatScale } from './heat';

describe('heat colours', () => {
  const s: HeatScale = { toleranceDeg: 1, windowMin: 20, capDeg: 5 };
  const min = 60_000;

  it('paints separations inside the tolerance solid yellow', () => {
    expect(heatColor(HeatMode.Align, 0.5, 0, s)).toEqual([255, 225, 77, 1]);
    expect(heatColor(HeatMode.Align, 1, 0, s)).toEqual([255, 225, 77, 1]);
  });

  it('fades towards violet beyond the tolerance', () => {
    const mid = heatColor(HeatMode.Align, 3, 0, s);
    const far = heatColor(HeatMode.Align, 5, 0, s);
    expect(mid[3]).toBeLessThan(1);
    expect(far).toEqual([76, 29, 149, 0.25]);
  });

  it('leaves unknown cells transparent', () => {
    for (const mode of [HeatMode.Align, HeatMode.Time, HeatMode.Visible, HeatMode.Viewshed]) {
      expect(heatColor(mode, NaN, 0, s)[3]).toBe(0);
    }
  });

  it('runs blue through white to red across the time window', () => {
    expect(heatColor(HeatMode.Time, 0, -20 * min, s)).toEqual([59, 130, 246, 1]);
    expect(heatColor(HeatMode.Time, 0, 0, s)).toEqual([255, 255, 255, 1]);
    expect(heatColor(HeatMode.Time, 0, 20 * min, s)).toEqual([239, 68, 68, 1]);
  });

  it('shades hidden ground and visible ground per mode', () => {
    expect(heatColor(HeatMode.Visible, 1, 0, s)[3]).toBe(0);
    expect(heatColor(HeatMode.Visible, 0, 0, s)).toEqual([27, 42, 74, 0.65]);
    expect(heatColor(HeatMode.Viewshed, 1, 0, s)).toEqual([56, 193, 114, 0.45]);
    expect(heatColor(HeatMode.Viewshed, 0, 0, s)[3]).toBe(0);
  });
});
