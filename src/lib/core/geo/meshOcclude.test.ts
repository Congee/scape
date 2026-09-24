import { describe, expect, it } from 'vitest';
import { anyOccluder, MeshOccluder } from './meshOcclude';
import type { SurfaceMesh } from './surfaces';

/** A soup mesh from world triangles; only `pos` and `idx` matter to the occluder. */
function soup(tris: number[]): SurfaceMesh {
  const nv = tris.length / 3;
  const z = new Float32Array(0);
  return { pos: Float32Array.from(tris), idx: Uint32Array.from({ length: nv }, (_, i) => i), surfId: z, bldgId: z, plane: z, surf: z, sphere: z, size: z, box: z, doubleSided: true, count: 1 };
}

// A 20 m wide, 100 m tall wall 50 m north of the eye.
const wall = soup([-10, 50, -5, 10, 50, -5, 10, 50, 95, -10, 50, -5, 10, 50, 95, -10, 50, 95]);

describe('MeshOccluder', () => {
  const occ = new MeshOccluder([wall]);

  it('hides the sky and far points behind the wall', () => {
    expect(occ.triangles).toBe(2);
    expect(occ.occludes(0, 1, 0.5, Infinity)).toBe(true);
    expect(occ.occludes(0.1, 1, 0, 200)).toBe(true);
  });

  it('leaves a point in front of the wall, above it, or beside it', () => {
    expect(occ.occludes(0, 1, 0, 40)).toBe(false);
    expect(occ.occludes(0, 1, 3, Infinity)).toBe(false);
    expect(occ.occludes(1, 1, 0, Infinity)).toBe(false);
    expect(occ.occludes(0, -1, 0, Infinity)).toBe(false);
  });

  it('handles a triangle straddling north', () => {
    const across = new MeshOccluder([soup([-30, 20, -5, 30, 20, -5, 0, 20, 60])]);
    expect(across.occludes(-0.2, 1, 0.3, Infinity)).toBe(true);
    expect(across.occludes(0.2, 1, 0.3, Infinity)).toBe(true);
  });

  it('handles the eye standing under a roof', () => {
    const roof = new MeshOccluder([soup([-10, -10, 5, 10, -10, 5, 0, 15, 5])]);
    expect(roof.occludes(0.01, 0.02, 1, Infinity)).toBe(true);
    expect(roof.occludes(3, 1, 0.1, Infinity)).toBe(false);
  });
});

function dir(azDeg: number, altDeg: number): [number, number, number] {
  const a = (azDeg * Math.PI) / 180;
  const h = (altDeg * Math.PI) / 180;
  return [Math.cos(h) * Math.sin(a), Math.cos(h) * Math.cos(a), Math.sin(h)];
}

describe('MeshOccluder edge cases', () => {
  const occ = new MeshOccluder([wall]);

  it('hides a target behind the wall but not one in front of it', () => {
    expect(occ.occludes(0, 1, 0.2, 60)).toBe(true);
    expect(occ.occludes(0, 1, 0.2, 49)).toBe(false);
  });

  it('hides a far target well beyond the mesh', () => {
    expect(occ.occludes(0, 1, 0.2, 1e7)).toBe(true);
  });

  it('finds a narrow far triangle across a bucket edge from either side', () => {
    // 0.2° wide, centred on 46° azimuth, 5 km out.
    const [e0, n0] = dir(45.9, 0);
    const [e1, n1] = dir(46.1, 0);
    const sliver = new MeshOccluder([soup([e0 * 5000, n0 * 5000, -10, e1 * 5000, n1 * 5000, -10, e1 * 5000, n1 * 5000, 400, e0 * 5000, n0 * 5000, -10, e1 * 5000, n1 * 5000, 400, e0 * 5000, n0 * 5000, 400])]);
    expect(sliver.occludes(...dir(45.95, 2), Infinity)).toBe(true);
    expect(sliver.occludes(...dir(46.05, 2), Infinity)).toBe(true);
    expect(sliver.occludes(...dir(45.8, 2), Infinity)).toBe(false);
    expect(sliver.occludes(...dir(46.2, 2), Infinity)).toBe(false);
    expect(sliver.occludes(...dir(46, 6), Infinity)).toBe(false);
  });

  it('handles near-zenith and zenith rays', () => {
    // An overhang 1 km up, east of the zenith and clear of it.
    const eave = new MeshOccluder([soup([1, -1, 1000, 3, -1, 1000, 2, 2, 1000])]);
    expect(eave.occludes(...dir(90, 89.9), Infinity)).toBe(true);
    expect(eave.occludes(...dir(270, 89.9), Infinity)).toBe(false);
    expect(eave.occludes(0, 0, 1, Infinity)).toBe(false);
    // A roof straight overhead catches the exact zenith whatever bucket it lands in.
    const roof = new MeshOccluder([soup([-10, -10, 5, 10, -10, 5, 0, 15, 5])]);
    expect(roof.occludes(0, 0, 1, Infinity)).toBe(true);
    expect(roof.occludes(0, 0, 1, 4)).toBe(false);
  });

  it('agrees with a brute-force test over every triangle', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const tris: number[] = [];
    for (let i = 0; i < 3000; i++) {
      const c = [rnd() * 400, rnd() * 400, rnd() * 40 + 20];
      for (let k = 0; k < 3; k++) tris.push(c[0] + rnd() * 8, c[1] + rnd() * 8, c[2] + rnd() * 8);
    }
    const mesh = soup(tris);
    const bvh = new MeshOccluder([mesh]);
    const one = (t: number) => new MeshOccluder([soup(Array.from(mesh.pos.subarray(t * 9, t * 9 + 9)))]);
    const singles = Array.from({ length: 3000 }, (_, t) => one(t));
    let hits = 0;
    for (let r = 0; r < 400; r++) {
      const ray = [rnd(), rnd(), r % 7 === 0 ? 0 : rnd() * 0.5];
      const dist = r % 3 === 0 ? Infinity : 150 + rnd() * 100;
      const want = singles.some((s) => s.occludes(ray[0], ray[1], ray[2], dist));
      if (want) hits++;
      expect(bvh.occludes(ray[0], ray[1], ray[2], dist)).toBe(want);
    }
    expect(hits).toBeGreaterThan(40);
  });

  it('handles an empty mesh and axis-aligned rays', () => {
    expect(new MeshOccluder([]).occludes(0, 1, 0, Infinity)).toBe(false);
    expect(occ.occludes(0, 1, 0, Infinity)).toBe(true);
    expect(occ.occludes(0, 0, 1, Infinity)).toBe(false);
  });
});

describe('anyOccluder', () => {
  it('drops the missing parts and ORs the rest', () => {
    expect(anyOccluder([null, null])).toBeNull();
    const occ = new MeshOccluder([wall]);
    expect(anyOccluder([null, occ])).toBe(occ);
    const both = anyOccluder([occ, { occludes: (_e, _n, u) => u < 0 }])!;
    expect(both.occludes(0, -1, -1, Infinity)).toBe(true);
    expect(both.occludes(0, 1, 0.5, Infinity)).toBe(true);
    expect(both.occludes(0, -1, 1, Infinity)).toBe(false);
  });
});
