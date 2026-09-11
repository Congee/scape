import { describe, expect, it } from 'vitest';
import { lngLatToTilePixel, metersPerPixel, tilePixelToLngLat, zoomForResolution } from './tiles';

describe('tiles', () => {
  it('puts the origin on the corner of tile 1/1 at z1', () => {
    const t = lngLatToTilePixel(0, 0, 1);
    expect(t).toMatchObject({ z: 1, x: 1, y: 1 });
    expect(t.px).toBeCloseTo(0, 6);
    expect(t.py).toBeCloseTo(0, 6);
  });

  it('wraps longitude and clamps latitude', () => {
    expect(lngLatToTilePixel(190, 0, 2).x).toBe(0);
    expect(lngLatToTilePixel(0, 89, 3).y).toBe(0);
  });

  it('round-trips through tilePixelToLngLat', () => {
    const t = lngLatToTilePixel(-74.1553, 40.7463, 14);
    const p = tilePixelToLngLat(t.z, t.x, t.y, t.px, t.py);
    expect(p.lng).toBeCloseTo(-74.1553, 6);
    expect(p.lat).toBeCloseTo(40.7463, 6);
  });

  it('knows the equatorial resolution ladder', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543, 0);
    expect(zoomForResolution(0, 156543, 0, 20)).toBe(0);
    expect(zoomForResolution(0, 4.78, 0, 20)).toBe(15);
    expect(zoomForResolution(0, 1, 8, 14)).toBe(14);
  });
});
