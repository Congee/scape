import { describe, expect, it } from 'vitest';
import { geoidAt, parseGsiGeoid } from '@core/geo/geoid';
import { gsiGeoidText } from '@core/geo/geoidFixture';
import { curvatureDropM, destination, distanceM, type LngLat } from '@core/geo/geodesy';
import type { GltfWorld } from '@core/model/gltf';
import { geodeticToEcef } from './ecef';
import { LOD2_REGIONS, type Lod2Region } from './regions';
import { lod2BuildingAt, lod2Tile, lod2Triangles, placeLod2 } from './tile';

const PIN: LngLat = { lng: 4.4868, lat: 51.9091 };
const REGION: Lod2Region = { ...LOD2_REGIONS[0], groundProperty: undefined, idProperty: undefined, geoidM: 40 };

/** Points given as lng/lat/ellipsoidal h, stored the way a tile does: y-up, relative to a translated tile frame. */
function world(pts: [number, number, number][], feature: number[], idx: number[], doc: GltfWorld['doc'] = { asset: { version: '2.0' } }, buffers: ArrayBuffer[] = []): { w: GltfWorld; transform: Float64Array } {
  const [tx, ty, tz] = geodeticToEcef(PIN.lng, PIN.lat, 0);
  const pos = new Float64Array(pts.length * 3);
  pts.forEach(([lng, lat, h], i) => {
    const [x, y, z] = geodeticToEcef(lng, lat, h);
    pos.set([x - tx, z - tz, -(y - ty)], i * 3);
  });
  const transform = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1]);
  return { w: { pos, idx: new Uint32Array(idx), feature: new Int32Array(feature), doc, buffers }, transform };
}

/** A 20 m square box building, apex `h` above the ellipsoid ground `g`, centred `d` m from the pin toward `az`. */
function box(az: number, d: number, g: number, h: number, f: number): { pts: [number, number, number][]; feature: number[]; idx: number[] } {
  const c = destination(PIN, az, d);
  const corner = (b: number) => destination(c, b, 10 * Math.SQRT2);
  const ring = [45, 135, 225, 315].map(corner);
  const pts: [number, number, number][] = [...ring.map((p): [number, number, number] => [p.lng, p.lat, g]), ...ring.map((p): [number, number, number] => [p.lng, p.lat, g + h])];
  // Walls only; the ring runs clockwise seen from above, so this winds them outward.
  const idx: number[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    idx.push(i, j + 4, j, i, i + 4, j + 4);
  }
  return { pts, feature: pts.map(() => f), idx };
}

describe('lod2Tile', () => {
  it('turns y-up tile content into lng/lat and sea-level altitude', () => {
    const b = box(90, 500, 45, 30, 0);
    const { w, transform } = world(b.pts, b.feature, b.idx);
    const t = lod2Tile(w, transform, REGION);
    expect(t.datumM).toBe(40);
    expect(t.world[0]).toBeCloseTo(b.pts[0][0], 10);
    expect(t.world[1]).toBeCloseTo(b.pts[0][1], 10);
    expect(t.world[2]).toBeCloseTo(5, 6);
    expect(t.buildings).toHaveLength(1);
    expect(t.buildings[0].baseM).toBeCloseTo(5, 6);
    expect(t.buildings[0].apexM).toBeCloseTo(35, 6);
    expect(t.buildings[0].hull).toHaveLength(4);
    expect(lod2Triangles(t)).toHaveLength(b.idx.length * 3);
  });

  it('reads the datum off the ground column and ids off the id column', () => {
    const a = box(0, 300, 44, 20, 0);
    const c = box(180, 300, 46, 10, 1);
    const n = a.pts.length;
    const ground = new Float32Array([0.5, 2.5]);
    const names = new TextEncoder().encode('AB');
    const bin = new Uint8Array(16);
    bin.set(new Uint8Array(ground.buffer), 0);
    bin.set(names, 8);
    const off = new Uint32Array([0, 1, 2]);
    const buffers = [bin.buffer, off.buffer];
    const doc = {
      asset: { version: '2.0' },
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 8 },
        { buffer: 0, byteOffset: 8, byteLength: 2 },
        { buffer: 1, byteOffset: 0, byteLength: 12 }
      ],
      extensions: {
        EXT_structural_metadata: {
          schema: { classes: { b: { properties: { g: { type: 'SCALAR', componentType: 'FLOAT32' }, id: { type: 'STRING' } } } } },
          propertyTables: [{ class: 'b', count: 2, properties: { g: { values: 0 }, id: { values: 1, stringOffsets: 2 } } }]
        }
      }
    };
    const { w, transform } = world([...a.pts, ...c.pts], [...a.feature, ...c.feature], [...a.idx, ...c.idx.map((i) => i + n)], doc, buffers);
    const t = lod2Tile(w, transform, { ...REGION, groundProperty: 'g', idProperty: 'id' });
    expect(t.datumM).toBeCloseTo(43.5, 6);
    expect(t.buildings.map((b) => b.id)).toEqual(['A', 'B']);
    expect(t.buildings[1].apexM).toBeCloseTo(12.5, 6);
    expect(lod2BuildingAt(t, destination(PIN, 180, 300))).toBe(1);
    expect(lod2BuildingAt(t, destination(PIN, 90, 300))).toBe(-1);
  });
  it('subtracts an imported geoid per vertex, where a tile-centre value would miss by the gradient', () => {
    // Synthetic 1 m / 10 km eastward rise on a GSI-shaped 1′ × 1.5′ grid around the pin.
    const g0 = { lat0: 51.8, lng0: 4.3, dLat: 1 / 60, dLng: 1.5 / 60, rows: 14, cols: 16 };
    const east = (lng: number) => Math.sign(lng - PIN.lng) * distanceM(PIN, { lng, lat: PIN.lat });
    const grid = parseGsiGeoid(gsiGeoidText(g0, (_, c) => 40 + east(g0.lng0 + c * g0.dLng) * 1e-4));
    const n = (p: LngLat) => geoidAt(grid, p.lat, p.lng);
    const a = box(90, 500, 0, 30, 0);
    const c = box(270, 500, 0, 30, 1);
    const pts = [...a.pts, ...c.pts].map(([lng, lat, h]): [number, number, number] => [lng, lat, h + 5 + n({ lng, lat })]);
    const { w, transform } = world(pts, [...a.feature, ...c.feature], [...a.idx, ...c.idx.map((i) => i + a.pts.length)]);
    const t = lod2Tile(w, transform, REGION, {}, (lat, lng) => geoidAt(grid, lat, lng));
    for (const b of t.buildings) {
      expect(b.baseM).toBeCloseTo(5, 3);
      expect(b.apexM).toBeCloseTo(35, 3);
      // The tile-centre constant is off by gradient × distance: 5 cm at 500 m.
      expect(Math.abs(n(b.c) - t.datumM)).toBeCloseTo(0.05, 2);
    }
    expect(t.world[2]).toBeCloseTo(5, 3);
  });

  it('reports the imported geoid at the tile centre as its datum', () => {
    const b = box(90, 500, 45, 30, 0);
    const { w, transform } = world(b.pts, b.feature, b.idx);
    expect(lod2Tile(w, transform, REGION, {}, () => 12).datumM).toBe(12);
    expect(lod2Tile(w, transform, REGION).datumM).toBe(40);
  });
});

describe('placeLod2', () => {
  it('places a vertex 10 km out to within a millimetre', () => {
    const az = 37;
    const eyeM = 12;
    const tip = destination(PIN, az, 10_000);
    const pts: [number, number, number][] = [
      [tip.lng, tip.lat, 140],
      [tip.lng + 0.0001, tip.lat, 140],
      [tip.lng, tip.lat + 0.0001, 140]
    ];
    const { w, transform } = world(pts, [0, 0, 0], [0, 1, 2]);
    const m = placeLod2(lod2Tile(w, transform, REGION), PIN, eyeM);
    const e = 10_000 * Math.sin(az * (Math.PI / 180));
    const n = 10_000 * Math.cos(az * (Math.PI / 180));
    expect(Math.abs(m.pos[0] - e)).toBeLessThan(1e-3);
    expect(Math.abs(m.pos[1] - n)).toBeLessThan(1e-3);
    expect(Math.abs(m.pos[2] - (100 - eyeM - curvatureDropM(10_000)))).toBeLessThan(1e-3);
  });

  it('gives each building its own culled row and outward planes', () => {
    const a = box(90, 200, 40, 30, 0);
    const { w, transform } = world(a.pts, a.feature, a.idx);
    const m = placeLod2(lod2Tile(w, transform, REGION), PIN, 0);
    expect(m.plane.length / 4).toBe(8);
    expect(m.count).toBe(1);
    expect(new Set(m.bldgId)).toEqual(new Set([0]));
    expect(m.size[3]).toBe(1);
    expect(m.size[7]).toBe(0);
    expect(m.sphere[3]).toBeCloseTo(Math.hypot(20, 20, 30) / 2, 1);
    // Every wall faces away from the building's centre.
    for (let s = 0; s < 8; s++) {
      const [nx, ny, nz] = m.plane.subarray(s * 4, s * 4 + 3);
      const v = s * 3;
      const cx = m.pos[v * 3] - m.sphere[0];
      const cy = m.pos[v * 3 + 1] - m.sphere[1];
      expect(nx * cx + ny * cy).toBeGreaterThan(0);
      expect(Math.abs(nz)).toBeLessThan(1e-3);
    }
  });
});
