import { describe, expect, it } from 'vitest';
import { AltitudeRef, localToLngLat, type ModelAnchor, type ModelPart } from '@core/model';
import { partsMesh } from '@core/model/mesh';
import { seedModel } from '@core/model/seed';
import { RoofShape, type BuildingBatch } from '@workers/buildings.protocol';
import { destination } from './geodesy';
import { modelTriangles, placeModel } from './modelPlace';
import { buildPrisms, type PrismTile } from './prismRaster';
import { PIN } from './batchFixture';

const ANCHOR: ModelAnchor = { ...destination(PIN, 30, 10_000), altRef: AltitudeRef.Ground, altM: 0, headingDeg: 0, scale: 1 };
const RING: [number, number][] = [
  [-20, -15],
  [25, -15],
  [25, 18],
  [-5, 30],
  [-20, 18]
];
const GROUND = 12;
const EYE = 40;

const part = (over: Partial<ModelPart> = {}): ModelPart => ({ id: 'p', ring: RING, baseM: 0, heightM: 180, roof: RoofShape.Flat, roofHeightM: 0, roofDirDeg: NaN, roofAcross: 0, ...over });

/** One Overture row with the same footprint, placed at the same lng/lat. */
function rowBatch(anchor: ModelAnchor, p: ModelPart): BuildingBatch {
  const pts = p.ring.map(([e, n]) => localToLngLat(anchor, e, n));
  const c = localToLngLat(anchor, 0, 0);
  return {
    tileKey: '14/0/0',
    count: 1,
    ringStart: Int32Array.from([0, pts.length]),
    lng: Float64Array.from(pts, (q) => q.lng),
    lat: Float64Array.from(pts, (q) => q.lat),
    heightM: Float32Array.of(p.heightM),
    minHeightM: Float32Array.of(p.baseM),
    roofShape: Uint8Array.of(p.roof),
    roofHeightM: Float32Array.of(p.roofHeightM),
    roofDirDeg: Float32Array.of(p.roofDirDeg),
    roofAcross: Uint8Array.of(p.roofAcross),
    cLng: Float64Array.of(c.lng),
    cLat: Float64Array.of(c.lat),
    groundM: Float32Array.of(GROUND)
  };
}

/** Worst distance from a model vertex to the nearest prism vertex, metres. */
function worstGap(pos: Float32Array, tile: PrismTile): number {
  const ref: [number, number, number][] = [];
  for (let j = 0; j < tile.e.length; j++) ref.push([tile.e[j], tile.n[j], tile.uBase[j]], [tile.e[j], tile.n[j], tile.uTop[j]]);
  let worst = 0;
  for (let v = 0; v < pos.length; v += 3) {
    let best = Infinity;
    for (const r of ref) best = Math.min(best, Math.hypot(pos[v] - r[0], pos[v + 1] - r[1], pos[v + 2] - r[2]));
    worst = Math.max(worst, best);
  }
  return worst;
}

describe('placeModel', () => {
  it('lands within a millimetre of the prism for the same footprint at 10 km', () => {
    const p = part();
    const placed = placeModel(partsMesh([p]), ANCHOR, GROUND, PIN, EYE);
    const tile = buildPrisms(rowBatch(ANCHOR, p), PIN, EYE);
    expect(placed.pos.length).toBeGreaterThan(0);
    expect(worstGap(placed.pos, tile)).toBeLessThan(1e-3);
  });

  it('keeps that match with a heading, a raised base and a scale', () => {
    const anchor = { ...ANCHOR, headingDeg: 37, scale: 1.25 };
    const p = part({ baseM: 20 });
    const scaled = { ...p, ring: p.ring.map(([e, n]) => [e * 1.25, n * 1.25] as [number, number]), baseM: 25, heightM: 225 };
    const placed = placeModel(partsMesh([p]), anchor, GROUND, PIN, EYE);
    const tile = buildPrisms(rowBatch({ ...anchor, scale: 1 }, scaled), PIN, EYE);
    expect(worstGap(placed.pos, tile)).toBeLessThan(1e-3);
  });

  it('puts a seeded model back where its Overture rows stand', () => {
    const batch = rowBatch(ANCHOR, part({ heightM: 90 }));
    const seeded = seedModel(batch, 'x')!;
    const placed = placeModel(partsMesh(seeded.parts!), seeded.anchor, seeded.groundM, PIN, EYE);
    expect(worstGap(placed.pos, buildPrisms(batch, PIN, EYE))).toBeLessThan(1e-3);
  });

  it('reaches the same apex as the prism under a gabled roof', () => {
    const p = part({ ring: [[-30, -10], [30, -10], [30, 10], [-30, 10]], roof: RoofShape.Gabled, roofHeightM: 12 });
    const placed = placeModel(partsMesh([p]), ANCHOR, GROUND, PIN, EYE);
    const tile = buildPrisms(rowBatch(ANCHOR, p), PIN, EYE);
    expect(Math.abs(placed.box[5] - Math.max(...tile.fU))).toBeLessThan(1e-3);
  });

  it('gives every triangle its own plane through its vertices', () => {
    const m = placeModel(partsMesh([part({ roof: RoofShape.Hipped, roofHeightM: 10 })]), ANCHOR, GROUND, PIN, EYE);
    expect(m.doubleSided).toBe(true);
    expect(m.plane.length / 4).toBe(m.idx.length / 3);
    expect(m.size[3]).toBe(2);
    for (let t = 0; t < m.idx.length / 3; t++) {
      const [nx, ny, nz, pc] = m.plane.subarray(t * 4, t * 4 + 4);
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5);
      for (let k = 0; k < 3; k++) {
        const v = (t * 3 + k) * 3;
        // Float32 at 10 km: a few millimetres of plane residue.
        expect(Math.abs(nx * m.pos[v] + ny * m.pos[v + 1] + nz * m.pos[v + 2] - pc)).toBeLessThan(0.01);
      }
    }
  });

  it('writes world triangles at sea-level altitude', () => {
    const tris = modelTriangles(partsMesh([part()]), ANCHOR, GROUND);
    let top = -Infinity;
    for (let i = 2; i < tris.length; i += 3) top = Math.max(top, tris[i]);
    expect(top).toBeCloseTo(GROUND + 180, 6);
  });

  it('stands on sea level when the ground is unknown', () => {
    const tris = modelTriangles(partsMesh([part()]), ANCHOR, NaN);
    expect(tris.every(Number.isFinite)).toBe(true);
    expect(Math.min(...tris.filter((_, i) => i % 3 === 2))).toBeCloseTo(0, 6);
  });

  it('throws instead of placing at NaN', () => {
    const mesh = partsMesh([part()]);
    expect(() => placeModel(mesh, ANCHOR, undefined as unknown as number, PIN, EYE)).toThrow(/ground is undefined/);
    expect(() => placeModel(mesh, ANCHOR, Infinity, PIN, EYE)).toThrow(/ground/);
    expect(() => placeModel(mesh, { ...ANCHOR, lat: NaN }, GROUND, PIN, EYE)).toThrow(/anchor lat/);
    expect(() => modelTriangles(mesh, { ...ANCHOR, scale: undefined as unknown as number }, GROUND)).toThrow(/anchor scale/);
    const bad = { ...mesh, pos: mesh.pos.map((v, i) => (i === 5 ? NaN : v)) };
    expect(() => modelTriangles(bad, ANCHOR, GROUND)).toThrow(/vertex 1/);
  });
});
