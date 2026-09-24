import { describe, expect, it } from 'vitest';
import { BUILDINGS_DEFAULT_MAX_TILES, BUILDINGS_ZOOM, buildingTileCount, buildingsByDefault } from './buildingsRegion';
import { tileRange } from './pmtiles';

const hobokenToHudsonYards = { west: -74.035, south: 40.735, east: -73.995, north: 40.76 };
const nyc = { west: -74.3, south: 40.5, east: -73.7, north: 40.95 };

describe('buildings region', () => {
  it('covers the box at z14 only', () => {
    const [r] = tileRange(hobokenToHudsonYards, BUILDINGS_ZOOM);
    expect(r).toEqual({ x0: 4822, x1: 4824, y0: 6157, y1: 6158 });
    expect(buildingTileCount(hobokenToHudsonYards)).toBe(6);
  });

  it('counts a box crossing the antimeridian once per side', () => {
    expect(buildingTileCount({ west: 179.99, south: -0.01, east: -179.99, north: 0.01 })).toBe(4);
  });

  it('is on by default for a neighbourhood, off for a metro area', () => {
    expect(buildingsByDefault(hobokenToHudsonYards)).toBe(true);
    expect(buildingTileCount(nyc)).toBeGreaterThan(BUILDINGS_DEFAULT_MAX_TILES);
    expect(buildingsByDefault(nyc)).toBe(false);
  });
});
