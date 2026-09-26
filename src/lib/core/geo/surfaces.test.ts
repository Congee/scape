import { describe, expect, it } from 'vitest';
import { cameraBasis, type Camera } from '@core/optics/projection';
import { PrismGl } from '@core/viewfinder/gl/prismGl';
import { RoofShape } from '@workers/buildings.protocol';
import { batchOf, PIN, rect, square, type Box } from './batchFixture';
import { buildPrisms } from './prismRaster';
import { adoptPrismSurfaces, earClip, earClipAt, prismSurfaces, surfaceBuffers, tileSurfaces } from './surfaces';

const CAM: Camera = { azimuthDeg: 20, elevationDeg: 2, focalMm: 50, frameWmm: 36, frameHmm: 24 };

const BOXES: Box[] = [
  { ring: square(0, 300, 20), heightM: 40 },
  { ring: rect(80, 420, 30, 12), heightM: 30, minHeightM: 6, groundM: 4, roofShape: RoofShape.Gabled, roofHeightM: 6 },
  { ring: rect(-90, 380, 24, 18), heightM: 25, roofShape: RoofShape.Hipped, roofHeightM: 5 },
  { ring: square(150, 250, 16), heightM: 22, roofShape: RoofShape.Pyramidal },
  { ring: square(-160, 520, 14), heightM: 35, roofShape: RoofShape.Dome, roofHeightM: 7 },
  { ring: rect(40, 700, 40, 20), heightM: 18, roofShape: RoofShape.Skillion, roofHeightM: 4, roofDirDeg: 110 },
  { ring: [[-20, 900], [30, 905], [10, 940], [0, 915], [-25, 930]], heightM: 60, groundM: 12 }
];

const fnv = (bytes: Uint8Array, h: number) => {
  for (const b of bytes) h = Math.imul(h ^ b, 16777619) >>> 0;
  return h;
};
const hash = (data: ArrayBufferView) => fnv(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), 2166136261).toString(16);

/** Every buffer and texture a PrismGl uploads, copied in order, through a WebGL2 stand-in. */
function uploads(draw: (gl: WebGL2RenderingContext) => void): Uint8Array[] {
  const out: Uint8Array[] = [];
  const take = (data: ArrayBufferView) => out.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice());
  const calls: Record<string, (...a: never[]) => unknown> = {
    bufferData: (_t: never, data: never) => take(data as ArrayBufferView),
    texSubImage2D: (...a: never[]) => take(a[8] as ArrayBufferView),
    getShaderParameter: () => true,
    getProgramParameter: () => true
  };
  const gl = new Proxy({}, { get: (_o, k: string) => calls[k] ?? (/^[A-Z_0-9]+$/.test(k) ? 1 : () => ({})) });
  draw(gl as WebGL2RenderingContext);
  return out;
}

describe('prismSurfaces', () => {
  const tile = buildPrisms(batchOf(BOXES), PIN, 3);

  // Pinned from PrismGl.mesh() before the surfaces were split out of it.
  it('uploads exactly what PrismGl built before the split', () => {
    const got = uploads((gl) => new PrismGl(gl).bounds(CAM, cameraBasis(CAM), [tile]));
    // Vertex attributes now go up as three buffers; interleaved they must match the old single one.
    const [pos, surfId, bldgId, ...rest] = got;
    const nv = surfId.length / 4;
    const inter = new Float32Array(nv * 5);
    const [p, s, b] = [pos, surfId, bldgId].map((x) => new Float32Array(x.buffer.slice(0)));
    for (let j = 0; j < nv; j++) inter.set([p[j * 3], p[j * 3 + 1], p[j * 3 + 2], s[j], b[j]], j * 5);
    expect([inter, ...rest].map(hash)).toEqual(GOLDEN);
  });

  it('uploads the same from a mesh the worker built and transferred', () => {
    const direct = uploads((gl) => new PrismGl(gl).bounds(CAM, cameraBasis(CAM), [tile])).map(hash);
    const sent = structuredClone({ t: buildPrisms(batchOf(BOXES), PIN, 3), m: prismSurfaces(tile) });
    adoptPrismSurfaces(sent.t, sent.m);
    expect(tileSurfaces(sent.t)).toBe(sent.m);
    expect(uploads((gl) => new PrismGl(gl).bounds(CAM, cameraBasis(CAM), [sent.t])).map(hash)).toEqual(direct);
  });

  it('transfers every mesh array without a copy', () => {
    const m = prismSurfaces(tile);
    const bufs = surfaceBuffers(m);
    expect(new Set(bufs).size).toBe(9);
    const got = structuredClone(m, { transfer: bufs });
    expect(m.pos.length).toBe(0);
    expect(got.idx.length).toBeGreaterThan(0);
  });

  it('keeps one surface row per plane and one sphere per building', () => {
    const m = prismSurfaces(tile);
    expect(m.plane.length).toBe(m.surf.length);
    expect(m.sphere.length).toBe(BOXES.length * 4);
    expect(m.pos.length / 3).toBe(m.surfId.length);
    expect(Math.max(...m.idx)).toBeLessThan(m.surfId.length);
    expect(m.doubleSided).toBe(false);
    for (let i = 0; i < BOXES.length; i++) expect(m.size[i * 4 + 3]).toBe(1);
  });
});

describe('earClipAt', () => {
  const RINGS: [number[], number[]][] = [
    [[0, 4, 4, 2, 0], [0, 0, 4, 1, 4]],
    [[0, 0, 4, 4], [0, 4, 4, 0]],
    // A bow tie has no ear; the fan still emits m - 2.
    [[0, 4, 4, 0], [0, 4, 0, 4]],
    [Array.from({ length: 90 }, (_, i) => Math.cos(i / 14.3) * (i % 2 ? 3 : 5)), Array.from({ length: 90 }, (_, i) => Math.sin(i / 14.3) * (i % 2 ? 3 : 5))]
  ];

  it('writes m - 2 triangles at the offset and returns the end', () => {
    for (const [px, py] of RINGS) {
      const out = new Uint32Array(3 + (px.length - 2) * 3 + 1).fill(7);
      const end = earClipAt(px, py, px.length, 10, out, 3);
      expect(end).toBe(3 + (px.length - 2) * 3);
      expect([out[0], out[end]]).toEqual([7, 7]);
      const want: number[] = [];
      earClip(px, py, 10, want);
      expect([...out.subarray(3, end)]).toEqual(want);
    }
  });

  it('clips only the first m points', () => {
    const [px, py] = RINGS[0];
    const out = new Uint32Array(3);
    expect(earClipAt([...px, 99, -99], [...py, 99, 99], 3, 0, out, 0)).toBe(3);
    expect([...out].toSorted()).toEqual([0, 1, 2]);
  });
});

const GOLDEN = ['3706896c', 'be9694bb', 'c8f518d6', 'b129f11d', '1adaca45', 'a000dea3'];
