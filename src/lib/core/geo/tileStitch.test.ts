import { describe, expect, it } from 'vitest';
import { decodeBuildings, type VectorLayerLike } from './buildingTiles';
import { clipToTile, edgeNeighbours, mergeTileRows, stitchPieces, type TilePiece, type TilePoint } from './tileStitch';
import { lngLatToTilePixel } from '@core/terrain/tiles';

/** Clockwise on screen, y down, like MVT outer rings. */
const rect = (x0: number, y0: number, x1: number, y1: number): TilePoint[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1]
];

const area = (ring: TilePoint[]) => {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return s / 2;
};

const piece = (tx: number, ty: number, ring: TilePoint[]): TilePiece => ({ tx, ty, ring: clipToTile(ring, tx, ty) });

describe('clipToTile', () => {
  it('cuts a buffered ring back to the tile square', () => {
    const r = clipToTile(rect(10.8, 20.2, 11.1, 20.6), 10, 20);
    expect(area(r)).toBeCloseTo(0.2 * 0.4, 9);
    expect(Math.max(...r.map((p) => p[0]))).toBe(11);
  });
});

describe('stitchPieces', () => {
  it('rejoins a rectangle cut by a vertical tile edge', () => {
    const whole = rect(10.8, 20.2, 11.3, 20.6);
    const rings = stitchPieces([piece(10, 20, whole), piece(11, 20, whole)]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
    expect(area(rings[0])).toBeCloseTo(0.5 * 0.4, 9);
  });

  it('absorbs a pixel of quantisation between the two sides of the seam', () => {
    const px = 1 / 4096;
    const rings = stitchPieces([piece(10, 20, rect(10.8, 20.2, 11.3, 20.6)), piece(11, 20, rect(10.8, 20.2 + px, 11.3, 20.6 - px))]);
    expect(rings).toHaveLength(1);
    expect(rings[0].length).toBeLessThanOrEqual(6);
    expect(area(rings[0])).toBeCloseTo(0.2, 3);
  });

  it('walks the seam where the two sides cover different spans', () => {
    const rings = stitchPieces([piece(10, 20, rect(10.8, 20.2, 11, 20.8)), piece(11, 20, rect(11, 20.5, 11.3, 20.8))]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(6);
    expect(area(rings[0])).toBeCloseTo(0.2 * 0.6 + 0.3 * 0.3, 9);
  });

  it('rejoins four quadrants around a tile corner', () => {
    const whole = rect(10.8, 20.8, 11.2, 21.2);
    const rings = stitchPieces([piece(10, 20, whole), piece(11, 20, whole), piece(10, 21, whole), piece(11, 21, whole)]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
    expect(area(rings[0])).toBeCloseTo(0.16, 9);
  });

  it('keeps a tile edge whose neighbour was not gathered', () => {
    const rings = stitchPieces([piece(10, 20, rect(10.8, 20.2, 11.3, 20.6))]);
    expect(rings).toHaveLength(1);
    expect(area(rings[0])).toBeCloseTo(0.2 * 0.4, 9);
  });
});

describe('mergeTileRows', () => {
  const EXTENT = 4096;
  const layer = (x0: number, x1: number): VectorLayerLike => ({
    length: 1,
    extent: EXTENT,
    feature: () => ({
      properties: { id: 'b1', height: 30 },
      loadGeometry: () => [
        [
          { x: x0, y: 1000 },
          { x: x1, y: 1000 },
          { x: x1, y: 2000 },
          { x: x0, y: 2000 },
          { x: x0, y: 1000 }
        ]
      ]
    })
  });
  const west = { z: 14, x: 4823, y: 6155 };
  const east = { z: 14, x: 4824, y: 6155 };
  // One building from 3000 px in the west tile to 1000 px in the east one, each clipped with a 128 px buffer.
  const a = decodeBuildings(layer(3000, 4224), undefined, west);
  const b = decodeBuildings(layer(-128, 1000), undefined, east);

  it('finds the neighbour across the edge the building reaches', () => {
    expect(edgeNeighbours(a, west)).toEqual([east]);
  });

  it('merges one feature cut by a tile edge into one row', () => {
    const merged = mergeTileRows([
      { tile: west, rows: a },
      { tile: east, rows: b }
    ]);
    expect(merged.count).toBe(1);
    expect(merged.heightM[0]).toBe(30);
    expect(merged.featureId).toEqual(['b1']);
    const xs = [...merged.lng].map((lng, k) => {
      const t = lngLatToTilePixel(lng, merged.lat[k], 14, EXTENT);
      return (t.x - west.x) * EXTENT + t.px;
    });
    expect(Math.min(...xs)).toBeCloseTo(3000, 3);
    expect(Math.max(...xs)).toBeCloseTo(EXTENT + 1000, 3);
    const c = lngLatToTilePixel(merged.cLng[0], merged.cLat[0], 14, EXTENT);
    expect((c.x - west.x) * EXTENT + c.px).toBeCloseTo(3000 + 1048, 1);
  });
});
