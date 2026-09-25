import { describe, expect, it } from 'vitest';
import { growBbox, laadsListingUrl, parseViirsName, pointBbox, tileName, tileOf, tilesForBbox, tilesForWindow, tilesNear, toCounts, VIIRS_PX_PER_DEG, windowAround } from './viirs';

describe('VIIRS tiles', () => {
  it('names the 10° tile holding a point', () => {
    expect(tileName(tileOf({ lat: 51.92, lng: 4.48 }))).toBe('h18v03');
    expect(tileName(tileOf({ lat: -24.9, lng: 16.0 }))).toBe('h19v11');
    expect(tileOf({ lat: 90, lng: 180 })).toEqual({ h: 35, v: 0 });
    expect(tileOf({ lat: -90, lng: -180 })).toEqual({ h: 0, v: 17 });
  });

  it('parses LAADS file names and ignores others', () => {
    expect(parseViirsName('VNP46A4.A2024001.h18v03.002.2025161220719.h5')).toEqual({ year: 2024, tile: { h: 18, v: 3 } });
    expect(parseViirsName('VNP46A3.A2024001.h18v03.h5')).toBeNull();
    expect(laadsListingUrl(2024)).toMatch(/VNP46A4\/2024\/001\.json$/);
  });

  it('covers a 300 km margin with the neighbouring tiles', () => {
    const tiles = tilesForBbox(growBbox(pointBbox({ lat: 51.92, lng: 4.48 }), 300)).map(tileName);
    expect(tiles).toEqual(expect.arrayContaining(['h18v03', 'h18v04', 'h17v03']));
    expect(tiles).not.toContain('h19v02');
  });

  it('wraps windows across the antimeridian', () => {
    const w = windowAround({ lat: -17, lng: 179.5 }, 100);
    expect(w.col0 + w.cols).toBeGreaterThan(360 * VIIRS_PX_PER_DEG);
    expect(tilesForWindow(w).map(tileName)).toEqual(expect.arrayContaining(['h35v10', 'h00v10']));
    expect(w.rows).toBeCloseTo((200 / 110.574) * VIIRS_PX_PER_DEG, -1);
  });

  it('caps high-latitude windows to the GPU texture size, centred on the point', () => {
    const p = { lat: 78, lng: 15 };
    expect(windowAround(p, 350).cols).toBeGreaterThan(4096);
    const w = windowAround(p, 350, 4096);
    expect(w.cols).toBe(4096);
    expect(w.rows).toBe(windowAround(p, 350).rows);
    expect(Math.abs(w.col0 + w.cols / 2 - (p.lng + 180) * VIIRS_PX_PER_DEG)).toBeLessThanOrEqual(1);
    expect(windowAround({ lat: 52, lng: 4 }, 350, 4096)).toEqual(windowAround({ lat: 52, lng: 4 }, 350));
  });

  it('stores radiance as 0.1 nW counts with fill and negatives dark', () => {
    expect(Array.from(toCounts([65535, 123, 0, 7000], 0.1, 0, 65535))).toEqual([0, 123, 0, 7000]);
    expect(Array.from(toCounts(new Float32Array([-1, 2.34, Number.NaN, 1e9]), 1, 0, null))).toEqual([0, 23, 0, 65535]);
  });

  it('lists the tiles regions and points need, margin included', () => {
    expect(tilesNear([{ lat: 51.92, lng: 4.48 }], [])).toEqual(['h17v03', 'h17v04', 'h18v03', 'h18v04']);
    expect(tilesNear([], [{ west: 4, south: 51.5, east: 5, north: 52 }])).toEqual(['h17v03', 'h17v04', 'h18v03', 'h18v04']);
    expect(tilesNear([], [])).toEqual([]);
  });
});
