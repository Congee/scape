import { describe, expect, it } from 'vitest';
import { cameraBasis, type Camera } from '@core/optics/projection';
import { RoofShape } from '@workers/buildings.protocol';
import { batchOf, PIN, rect, square, type Box } from './batchFixture';
import { buildPrisms, sphereVisible, type PrismTile } from './prismRaster';

const prisms = (boxes: Box[], eyeM = 0) => buildPrisms(batchOf(boxes), PIN, eyeM);

/** Walls kept for building i, as outward normals. */
function walls(tile: PrismTile, i = 0): { nx: number; ny: number }[] {
  const out: { nx: number; ny: number }[] = [];
  for (let a = tile.ringStart[i]; a < tile.ringStart[i + 1]; a++) if (tile.wOk[a]) out.push({ nx: tile.wNx[a], ny: tile.wNy[a] });
  return out;
}

/** What the GPU mesh triangulates out of a tile: two triangles per wall quad, a fan per roof face. */
function casterTriangles(tile: PrismTile) {
  let wall = 0;
  for (let i = 0; i < tile.count; i++) for (let a = tile.ringStart[i]; a < tile.ringStart[i + 1]; a++) if (tile.wOk[a]) wall += 2;
  let roof = 0;
  for (let q = 0; q < tile.faceStart[tile.count]; q++) roof += tile.faceVert[q + 1] - tile.faceVert[q] - 2;
  return { wall, roof, total: wall + roof };
}

describe('buildPrisms', () => {
  it('keeps all four walls of a box, including the one facing away from the eye', () => {
    const tile = prisms([{ ring: square(0, 300, 60), heightM: 60 }]);
    const w = walls(tile);
    expect(w).toHaveLength(4);
    // The far wall's normal points north, straight away from the eye at the origin.
    expect(w.filter((q) => q.ny > 0.99)).toHaveLength(1);
    expect(w.filter((q) => q.ny < -0.99)).toHaveLength(1);
    for (const q of w) expect(Math.hypot(q.nx, q.ny)).toBeCloseTo(1, 6);
  });

  it('builds the same walls whichever side of the building the eye stands on', () => {
    const north = walls(prisms([{ ring: square(0, 300, 60), heightM: 60 }]));
    const south = walls(prisms([{ ring: square(0, -300, 60), heightM: 60 }]));
    expect(south).toHaveLength(north.length);
    for (const q of north) expect(south.some((p) => Math.abs(p.nx - q.nx) < 1e-3 && Math.abs(p.ny - q.ny) < 1e-3)).toBe(true);
  });

  it('winds walls outward whichever way the footprint ring winds', () => {
    const ring = square(0, 300, 60);
    const ccw = walls(prisms([{ ring, heightM: 60 }]));
    const cw = walls(prisms([{ ring: ring.toReversed(), heightM: 60 }]));
    expect(cw).toHaveLength(4);
    for (const q of ccw) expect(cw.some((p) => Math.abs(p.nx - q.nx) < 1e-3 && Math.abs(p.ny - q.ny) < 1e-3)).toBe(true);
  });

  it('keeps a roof plane that sits above the eye, where the camera sees only its underside', () => {
    const tile = prisms([{ ring: square(0, 300, 60), heightM: 60 }]);
    expect(tile.faceStart[1] - tile.faceStart[0]).toBe(1);
    // N·P = fPc with N up: a roof 60 m over the eye is on the far side of the eye's own plane.
    expect(tile.fPc[0]).toBeGreaterThan(55);
    expect(tile.fNz[0]).toBeCloseTo(1, 6);
  });

  it('drops the curvature of the earth out of every vertex', () => {
    const near = prisms([{ ring: square(0, 300, 60), heightM: 60 }]);
    const far = prisms([{ ring: square(0, 20_000, 60), heightM: 60 }]);
    expect(near.uTop[0]).toBeCloseTo(60, 1);
    // ~31 m of drop at 20 km, so the same 60 m building tops out well below the eye's horizontal.
    expect(far.uTop[0]).toBeLessThan(35);
    expect(far.uTop[0]).toBeGreaterThan(25);
  });

  it('floats a building_part on its min_height', () => {
    const tile = prisms([{ ring: square(0, 300, 60), heightM: 140, minHeightM: 100 }]);
    expect(tile.uBase[0]).toBeCloseTo(100, 0);
    expect(tile.uTop[0]).toBeCloseTo(140, 0);
  });

  it('gives a degenerate footprint no walls and no roof faces instead of throwing', () => {
    const tile = prisms([
      { ring: [[-10, 290], [10, 290]], heightM: 40, roofShape: RoofShape.Gabled, roofHeightM: 10 },
      { ring: [[NaN, NaN], [10, 290], [0, 310]], heightM: 40, roofShape: RoofShape.Hipped },
      { ring: square(100, 300, 0), heightM: 40, roofShape: RoofShape.Dome, roofHeightM: 10 }
    ]);
    expect(casterTriangles(tile).total).toBe(0);
  });

  it('counts the casters a dense tile of mixed roofs contributes', () => {
    const shapes = [RoofShape.Flat, RoofShape.Skillion, RoofShape.Gabled, RoofShape.Hipped, RoofShape.Pyramidal, RoofShape.Dome];
    const boxes: Box[] = [];
    for (let i = 0; i < 3000; i++) {
      // Deterministic scatter across a 2 km wedge in front of the eye.
      const e = ((i * 733) % 2000) - 1000;
      const n = 300 + ((i * 457) % 1700);
      boxes.push({ ring: rect(e, n, 20 + (i % 40), 16 + (i % 25)), heightM: 20 + (i % 180), roofShape: shapes[i % shapes.length], roofHeightM: i % 3 === 0 ? 0 : 5 + (i % 12), roofDirDeg: i % 4 === 0 ? NaN : (i * 37) % 360, roofAcross: i % 5 === 0 ? 1 : 0 });
    }
    const tile = buildPrisms(batchOf(boxes), PIN, 20);
    const t = casterTriangles(tile);
    // Every ring edge is a wall now, gable peaks included, and nothing drops it.
    expect(t.wall).toBe(2 * tile.ringStart[tile.count]);
    expect(t.roof).toBeGreaterThan(3000);
  });
});

describe('sphereVisible', () => {
  const cam: Camera = { azimuthDeg: 0, elevationDeg: 0, focalMm: 50, frameWmm: 36, frameHmm: 24 };
  const basis = cameraBasis(cam);
  const coneDeg = (Math.atan(Math.hypot(36, 24) / 2 / 50) * 180) / Math.PI;
  const visible = (e: number, n: number, u: number, r: number) => sphereVisible(e, n, u, r, basis, 50, 36, 24, coneDeg);

  it('keeps what is in the frame and drops what is behind or beside it', () => {
    expect(visible(0, 300, 0, 10)).toBe(true);
    expect(visible(0, -300, 0, 10)).toBe(false);
    expect(visible(300, 10, 0, 10)).toBe(false);
    // Straddling the near plane: the diagonal cone test, which a sphere round the eye passes.
    expect(visible(0, 5, 0, 50)).toBe(true);
  });
});
