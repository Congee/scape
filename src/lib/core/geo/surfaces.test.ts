import { describe, expect, it } from 'vitest';
import { cameraBasis, type Camera } from '@core/optics/projection';
import { PrismGl } from '@core/viewfinder/gl/prismGl';
import { RoofShape } from '@workers/buildings.protocol';
import { batchOf, PIN, rect, square, type Box } from './batchFixture';
import { buildPrisms } from './prismRaster';
import { prismSurfaces } from './surfaces';

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

/** Every buffer and texture a PrismGl uploads, hashed in order, through a WebGL2 stand-in. */
function uploads(draw: (gl: WebGL2RenderingContext) => void): string[] {
  const out: string[] = [];
  const take = (data: ArrayBufferView) => out.push(fnv(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), 2166136261).toString(16));
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
    expect(got).toEqual(GOLDEN);
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

const GOLDEN = ['3706896c', 'be9694bb', 'c8f518d6', 'b129f11d', '1adaca45', 'a000dea3'];
