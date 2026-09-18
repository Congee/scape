import { describe, expect, it } from 'vitest';
import { decodeTerrarium } from './dem';
import { encodeTerrarium, encodeTerrariumPadded, TERRARIUM_MAX_M, TERRARIUM_MIN_M, TERRARIUM_STEP_M } from './terrarium';

// Below one outlier neighbourhood, so the decoder's repair passes leave the posts alone.
const SIZE = 4;
const heights = Float32Array.from([
  0, 8848, -430.5, 1234.75, -11_000, 1, -1, 0.5, 4807.25, -0.00390625, 2000.1, 3000.9, 100, 200.5, 300.25, 400.125
]);

describe('encodeTerrarium', () => {
  it('round-trips through decodeTerrarium to within the format quantum', () => {
    const { elev, repaired } = decodeTerrarium(encodeTerrarium(heights, SIZE), SIZE, 4);
    expect(repaired).toBe(0);
    for (let i = 0; i < heights.length; i++) expect(Math.abs(elev[i] - heights[i])).toBeLessThanOrEqual(TERRARIUM_STEP_M);
  });

  it('keeps the fraction a resample leaves rather than truncating it', () => {
    const frac = Float32Array.from([1000.5]);
    const rgba = encodeTerrarium(frac, 1);
    expect(Array.from(rgba)).toEqual([131, 232, 128, 255]);
  });

  it('clamps to the representable range and maps NaN to the nodata sentinel', () => {
    expect(Array.from(encodeTerrarium(Float32Array.of(TERRARIUM_MIN_M - 10), 1))).toEqual([0, 0, 0, 255]);
    expect(Array.from(encodeTerrarium(Float32Array.of(TERRARIUM_MAX_M + 10), 1))).toEqual([255, 255, 255, 255]);
    expect(Array.from(encodeTerrarium(Float32Array.of(NaN), 1))).toEqual([0, 0, 0, 255]);
  });
});

/** Terrarium bytes for a smooth alpine surface: in envelope everywhere, so the decoder repairs nothing. */
function alpineTile(size: number): Uint8Array {
  const elev = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) elev[y * size + x] = 1500 + 900 * Math.sin(x / 7) * Math.cos(y / 5) + ((x * 31 + y * 17) % 64) / 256;
  return encodeTerrarium(elev, size);
}

describe('the DEM decode/encode loop', () => {
  it('returns real tile bytes unchanged, which is what keeps MapLibre off the canvas', () => {
    const size = 32;
    const bytes = alpineTile(size);
    const { elev, repaired } = decodeTerrarium(bytes, size, 4);
    expect(repaired).toBe(0);
    expect(encodeTerrarium(elev, size)).toEqual(bytes);
  });
});

describe('encodeTerrariumPadded', () => {
  const size = 8;
  const elev = Float32Array.from({ length: size * size }, (_, i) => 100 + i);
  const stride = size + 4;
  const padded = encodeTerrariumPadded(elev, size);

  it('allocates the (size + 4)² buffer DEMData reads as a Uint32Array', () => {
    expect(padded.length).toBe(stride * stride * 4);
    expect(padded.byteOffset).toBe(0);
  });

  it('puts the real pixels at (2, 2) and leaves the border for DEMData to fill', () => {
    const rgba = encodeTerrarium(elev, size);
    for (let y = 0; y < size; y++) {
      const row = padded.subarray(((y + 2) * stride + 2) * 4, ((y + 2) * stride + 2 + size) * 4);
      expect(Array.from(row)).toEqual(Array.from(rgba.subarray(y * size * 4, (y + 1) * size * 4)));
    }
    expect(Array.from(padded.subarray(0, stride * 2 * 4)).every((b) => b === 0)).toBe(true);
  });
});
