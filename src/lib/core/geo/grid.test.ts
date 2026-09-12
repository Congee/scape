import { describe, expect, it } from 'vitest';
import { distanceM } from './geodesy';
import { cellCentre, cellOf, cellSizeM, gridAround, gridCentre, gridCorners } from './grid';

describe('heat grid', () => {
  const c = { lat: 46.0207, lng: 7.7491 };
  const g = gridAround(c, 10_000, 40);

  it('is square on the ground and centred', () => {
    const centre = gridCentre(g);
    expect(distanceM(centre, c)).toBeLessThan(1);
    expect(cellSizeM(g)).toBeCloseTo(500, -1);
    const [tl, tr, br, bl] = gridCorners(g).map(([lng, lat]) => ({ lng, lat }));
    expect(Math.abs(distanceM(tl, tr) - 20_000)).toBeLessThan(100);
    expect(Math.abs(distanceM(tl, bl) - 20_000)).toBeLessThan(100);
    expect(tl.lat).toBeGreaterThan(bl.lat);
    expect(tr.lng).toBeGreaterThan(tl.lng);
    expect(br.lat).toBeCloseTo(bl.lat, 9);
  });

  it('maps cells to positions and back', () => {
    for (const [row, col] of [
      [0, 0],
      [39, 39],
      [17, 5]
    ]) {
      const p = cellCentre(g, row, col);
      expect(cellOf(g, p)).toEqual({ row, col });
    }
    expect(cellOf(g, { lat: 47, lng: 7.7 })).toBeNull();
    expect(cellOf(g, c)).toEqual({ row: 20, col: 20 });
  });
});
