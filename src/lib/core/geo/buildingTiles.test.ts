import { describe, expect, it } from 'vitest';
import { decodeBuildings, tilesForWedge, type VectorFeatureLike, type VectorLayerLike } from './buildingTiles';
import { bearingDeg, destination, distanceM, normalizeBearing } from './geodesy';
import { lngLatToTilePixel, tileKey, tilePixelToLngLat } from '@core/terrain/tiles';

const PIN = { lat: 40.74795, lng: -74.02369 };
const EXTENT = 4096;

const layerOf = (features: VectorFeatureLike[]): VectorLayerLike => ({
  length: features.length,
  extent: EXTENT,
  feature: (i) => features[i]
});

/** Clockwise on screen in tile space (y grows downward) — the MVT outer-ring winding. */
const square = (x: number, y: number, s: number) => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
  { x, y }
];
const reversed = (ring: { x: number; y: number }[]) => ring.toReversed();

const feature = (properties: Record<string, unknown>, rings: { x: number; y: number }[][]): VectorFeatureLike => ({
  properties,
  loadGeometry: () => rings
});

describe('tilesForWedge', () => {
  it('returns the pin tile first and orders the rest by distance', () => {
    const tiles = tilesForWedge(PIN, 40, 60, 20000);
    const pin = lngLatToTilePixel(PIN.lng, PIN.lat, 14);
    expect(tileKey(14, tiles[0].x, tiles[0].y)).toBe(tileKey(14, pin.x, pin.y));
    const dists = tiles.map((t) => distanceM(PIN, tilePixelToLngLat(14, t.x, t.y, 128, 128)));
    expect(dists.slice(1)).toEqual(dists.slice(1).toSorted((a, b) => a - b));
  });

  it('caps the result at max', () => {
    expect(tilesForWedge(PIN, 0, 360, 20000, 14, 12)).toHaveLength(12);
  });

  it('covers a full 360 degree span in every direction', () => {
    const tiles = tilesForWedge(PIN, 0, 360, 3000, 14, 200);
    const centres = tiles.map((t) => tilePixelToLngLat(14, t.x, t.y, 128, 128));
    for (const az of [0, 90, 180, 270]) {
      const p = destination(PIN, az, 1500);
      expect(centres.some((c) => distanceM(c, p) < 3000)).toBe(true);
    }
  });

  it('keeps a narrow wedge to tiles along that bearing', () => {
    const tiles = tilesForWedge(PIN, 90, 5, 12000, 14, 48);
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.length).toBeLessThan(tilesForWedge(PIN, 0, 360, 12000, 14, 999).length / 4);
    // Near the pin a tile corner can sit far off the ray; far tiles must hug it.
    for (const t of tiles) {
      const c = tilePixelToLngLat(14, t.x, t.y, 128, 128);
      if (distanceM(PIN, c) < 6000) continue;
      const off = normalizeBearing(bearingDeg(PIN, c) - 90);
      expect(Math.min(off, 360 - off)).toBeLessThan(25);
    }
  });
});

describe('decodeBuildings', () => {
  const tile = { z: 14, x: 4823, y: 6160 };

  it('skips features flagged hide_3d', () => {
    const l = layerOf([feature({ hide_3d: true, render_height: 100 }, [square(0, 0, 100)])]);
    expect(decodeBuildings(l, tile).count).toBe(0);
  });

  it('reads render_height and render_min_height with fallbacks', () => {
    const l = layerOf([
      feature({ render_height: 395, render_min_height: 12 }, [square(0, 0, 100)]),
      feature({ height: '42', min_height: '3' }, [square(200, 200, 100)]),
      feature({}, [square(400, 400, 100)])
    ]);
    const b = decodeBuildings(l, tile);
    expect([...b.heightM]).toEqual([395, 42, 5]);
    expect([...b.minHeightM]).toEqual([12, 3, 0]);
  });

  it('treats clockwise-on-screen rings as outer and skips the reversed ones as holes', () => {
    const outer = decodeBuildings(layerOf([feature({}, [square(0, 0, 100)])]), tile);
    expect(outer.count).toBe(1);
    const hole = decodeBuildings(layerOf([feature({}, [reversed(square(0, 0, 100))])]), tile);
    expect(hole.count).toBe(0);
  });

  it('keeps only the outer ring of a polygon with a hole', () => {
    const l = layerOf([feature({}, [square(0, 0, 400), reversed(square(100, 100, 100))])]);
    const b = decodeBuildings(l, tile);
    expect(b.count).toBe(1);
    expect([...b.ringStart]).toEqual([0, 4]);
  });

  it('drops the closing vertex and rings with too few distinct vertices', () => {
    const b = decodeBuildings(layerOf([feature({}, [square(0, 0, 100)])]), tile);
    expect(b.lng).toHaveLength(4);
    const thin = decodeBuildings(
      layerOf([
        feature({}, [
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 0, y: 0 }
          ]
        ])
      ]),
      tile
    );
    expect(thin.count).toBe(0);
  });

  it('places tile pixels at the lng/lat the Mercator inverse gives', () => {
    const b = decodeBuildings(layerOf([feature({}, [square(1024, 2048, 100)])]), tile);
    const want = tilePixelToLngLat(tile.z, tile.x, tile.y, 1024, 2048, EXTENT);
    expect(b.lng[0]).toBeCloseTo(want.lng, 10);
    expect(b.lat[0]).toBeCloseTo(want.lat, 10);
  });

  it('puts the centroid of a square at its middle', () => {
    const b = decodeBuildings(layerOf([feature({}, [square(1000, 1000, 200)])]), tile);
    const want = tilePixelToLngLat(tile.z, tile.x, tile.y, 1100, 1100, EXTENT);
    expect(b.cLng[0]).toBeCloseTo(want.lng, 10);
    expect(b.cLat[0]).toBeCloseTo(want.lat, 10);
  });
});
