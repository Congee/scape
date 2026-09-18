import { describe, expect, it } from 'vitest';
import { decodeBuildings, groundForRows, heightAtPoint, tilesForWedge, type VectorFeatureLike, type VectorLayerLike } from './buildingTiles';
import { bearingDeg, destination, distanceM, normalizeBearing } from './geodesy';
import { lngLatToTilePixel, tileKey, tilePixelToLngLat } from '@core/terrain/tiles';
import { RoofShape } from '@workers/buildings.protocol';

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
    expect(decodeBuildings(l, undefined, tile).count).toBe(0);
  });

  it('reads height and min_height, with the OpenMapTiles aliases as fallbacks', () => {
    const l = layerOf([
      feature({ render_height: 395, render_min_height: 12 }, [square(0, 0, 100)]),
      feature({ height: '42', min_height: '3' }, [square(200, 200, 100)]),
      feature({}, [square(400, 400, 100)])
    ]);
    const b = decodeBuildings(l, undefined, tile);
    expect([...b.heightM]).toEqual([395, 42, 5]);
    expect([...b.minHeightM]).toEqual([12, 3, 0]);
  });

  it('treats clockwise-on-screen rings as outer and skips the reversed ones as holes', () => {
    const outer = decodeBuildings(layerOf([feature({}, [square(0, 0, 100)])]), undefined, tile);
    expect(outer.count).toBe(1);
    const hole = decodeBuildings(layerOf([feature({}, [reversed(square(0, 0, 100))])]), undefined, tile);
    expect(hole.count).toBe(0);
  });

  it('keeps only the outer ring of a polygon with a hole', () => {
    const l = layerOf([feature({}, [square(0, 0, 400), reversed(square(100, 100, 100))])]);
    const b = decodeBuildings(l, undefined, tile);
    expect(b.count).toBe(1);
    expect([...b.ringStart]).toEqual([0, 4]);
  });

  it('drops the closing vertex and rings with too few distinct vertices', () => {
    const b = decodeBuildings(layerOf([feature({}, [square(0, 0, 100)])]), undefined, tile);
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
      undefined,
      tile
    );
    expect(thin.count).toBe(0);
  });

  it('places tile pixels at the lng/lat the Mercator inverse gives', () => {
    const b = decodeBuildings(layerOf([feature({}, [square(1024, 2048, 100)])]), undefined, tile);
    const want = tilePixelToLngLat(tile.z, tile.x, tile.y, 1024, 2048, EXTENT);
    expect(b.lng[0]).toBeCloseTo(want.lng, 10);
    expect(b.lat[0]).toBeCloseTo(want.lat, 10);
  });

  it('puts the centroid of a square at its middle', () => {
    const b = decodeBuildings(layerOf([feature({}, [square(1000, 1000, 200)])]), undefined, tile);
    const want = tilePixelToLngLat(tile.z, tile.x, tile.y, 1100, 1100, EXTENT);
    expect(b.cLng[0]).toBeCloseTo(want.lng, 10);
    expect(b.cLat[0]).toBeCloseTo(want.lat, 10);
  });
});

describe('decodeBuildings parts and roofs', () => {
  const tile = { z: 14, x: 4824, y: 6157 };

  it('skips a building with parts and groups its parts under it', () => {
    const b = decodeBuildings(
      layerOf([
        feature({ id: 'tower', height: 395, has_parts: true }, [square(0, 0, 400)]),
        feature({ id: 'plain', height: 20 }, [square(1000, 1000, 100)])
      ]),
      layerOf([
        feature({ building_id: 'tower', height: 340, min_height: 335 }, [square(0, 0, 400)]),
        feature({ building_id: 'tower', height: 395 }, [square(50, 50, 200)])
      ]),
      tile
    );
    expect([...b.heightM]).toEqual([20, 340, 395]);
    expect(b.group[1]).toBe(b.group[2]);
    expect(b.group[0]).not.toBe(b.group[1]);
    expect([...b.minHeightM]).toEqual([0, 335, 0]);
  });

  it('gives id-less features a group of their own', () => {
    const b = decodeBuildings(layerOf([feature({}, [square(0, 0, 100)]), feature({}, [square(200, 200, 100)])]), undefined, tile);
    expect(b.group[0]).not.toBe(b.group[1]);
  });

  it('falls back from height to floors to a class default', () => {
    const b = decodeBuildings(
      layerOf([
        feature({ height: 42 }, [square(0, 0, 100)]),
        feature({ num_floors: 4 }, [square(200, 0, 100)]),
        feature({ num_floors: 4, roof_height: 2 }, [square(400, 0, 100)]),
        feature({ class: 'house' }, [square(600, 0, 100)]),
        feature({ class: 'shed' }, [square(800, 0, 100)]),
        feature({ subtype: 'residential' }, [square(1000, 0, 100)]),
        feature({ class: 'something_else' }, [square(1200, 0, 100)]),
        feature({ height: 0, num_floors: 0, class: 'warehouse' }, [square(1400, 0, 100)])
      ]),
      undefined,
      tile
    );
    expect([...b.heightM]).toEqual([42, 12, 14, 6, 3, 6, 5, 5]);
  });

  it('zeroes a min_height that is not below the apex', () => {
    const b = decodeBuildings(layerOf([feature({ height: 10, min_height: 10 }, [square(0, 0, 100)]), feature({ height: 10, min_height: 12 }, [square(200, 0, 100)])]), undefined, tile);
    expect([...b.minHeightM]).toEqual([0, 0]);
  });

  it('maps roof shapes, defaulting to flat when absent and Other when unknown', () => {
    const shapes = ['flat', 'sawtooth', 'skillion', 'pyramidal', 'cone', 'gabled', 'gambrel', 'saltbox', 'round', 'hipped', 'half_hipped', 'mansard', 'dome', 'onion', 'spherical', 'quadruple_saltbox'];
    const b = decodeBuildings(
      layerOf([...shapes.map((roof_shape, i) => feature({ roof_shape }, [square(i * 200, 0, 100)])), feature({}, [square(0, 1000, 100)])]),
      undefined,
      tile
    );
    expect([...b.roofShape]).toEqual([
      RoofShape.Flat,
      RoofShape.Flat,
      RoofShape.Skillion,
      RoofShape.Pyramidal,
      RoofShape.Pyramidal,
      RoofShape.Gabled,
      RoofShape.Gabled,
      RoofShape.Gabled,
      RoofShape.Gabled,
      RoofShape.Hipped,
      RoofShape.Hipped,
      RoofShape.Hipped,
      RoofShape.Dome,
      RoofShape.Dome,
      RoofShape.Dome,
      RoofShape.Other,
      RoofShape.Flat
    ]);
  });

  it('keeps a roof height only while it fits between min_height and the apex', () => {
    const b = decodeBuildings(
      layerOf([
        feature({ height: 395, min_height: 335, roof_height: 255 }, [square(0, 0, 100)]),
        feature({ height: 20, roof_height: 5 }, [square(200, 0, 100)]),
        feature({ height: 20, roof_height: 20 }, [square(400, 0, 100)])
      ]),
      undefined,
      tile
    );
    expect([...b.roofHeightM]).toEqual([0, 5, 0]);
  });

  it('reads roof direction and orientation, leaving direction NaN when absent', () => {
    const b = decodeBuildings(
      layerOf([
        feature({ roof_direction: 121, roof_orientation: 'across' }, [square(0, 0, 100)]),
        feature({ roof_direction: '0', roof_orientation: 'along' }, [square(200, 0, 100)]),
        feature({}, [square(400, 0, 100)])
      ]),
      undefined,
      tile
    );
    expect([...b.roofDirDeg]).toEqual([121, 0, NaN]);
    expect([...b.roofAcross]).toEqual([1, 0, 0]);
  });
});

describe('heightAtPoint', () => {
  const tile = { z: 14, x: 4824, y: 6157 };
  const at = (x: number, y: number) => tilePixelToLngLat(tile.z, tile.x, tile.y, x, y, EXTENT);

  const rows = decodeBuildings(
    layerOf([feature({ id: 'tower', has_parts: true }, [square(0, 0, 400)])]),
    layerOf([
      feature({ building_id: 'tower', height: 40 }, [square(0, 0, 400)]),
      feature({ building_id: 'tower', height: 395 }, [square(100, 100, 100)]),
      feature({ id: 'other', height: 12 }, [square(2000, 2000, 200)])
    ]),
    tile
  );

  it('returns the tallest part of the building a podium belongs to', () => {
    expect(heightAtPoint(rows, at(20, 20))).toBe(395);
    expect(heightAtPoint(rows, at(150, 150))).toBe(395);
  });

  it('keeps a separate building on its own height', () => {
    expect(heightAtPoint(rows, at(2100, 2100))).toBe(12);
  });

  it('returns null off every footprint', () => {
    expect(heightAtPoint(rows, at(1000, 1000))).toBeNull();
  });
});

describe('groundForRows', () => {
  const tile = { z: 14, x: 4824, y: 6157 };

  const rows = decodeBuildings(
    layerOf([feature({ id: 'a' }, [square(0, 0, 400)]), feature({ id: 'b' }, [square(2000, 2000, 400)])]),
    layerOf([feature({ building_id: 'a' }, [square(1000, 0, 400)])]),
    tile
  );

  it('gives every row of a building the lowest sample under any of its footprints', () => {
    // Only the part's own footprint is low; the parent still stands on it.
    const part = Array.from(rows.lng.slice(rows.ringStart[2], rows.ringStart[3]));
    const ground = groundForRows(rows, (lng) => (lng >= Math.min(...part) && lng <= Math.max(...part) ? 3 : 100));
    expect([...ground]).toEqual([3, 100, 3]);
  });

  it('is NaN where no sample had elevation data', () => {
    const ground = groundForRows(rows, () => NaN);
    expect([...ground].every(Number.isNaN)).toBe(true);
  });

  it('ignores samples without data when others have it', () => {
    let n = 0;
    const ground = groundForRows(rows, () => (n++ % 2 === 0 ? NaN : 7));
    expect([...ground]).toEqual([7, 7, 7]);
  });
});
