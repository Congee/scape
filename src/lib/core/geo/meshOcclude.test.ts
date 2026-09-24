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
