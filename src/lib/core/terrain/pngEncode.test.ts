import { describe, expect, it } from 'vitest';
import { decodeTerrarium } from './dem';
import { decodePng } from './png';
import { crc32, encodeRgbaPng } from './pngEncode';
import { encodeTerrarium } from './terrarium';

const SIZE = 4;
const heights = Float32Array.from([0, 8848, -430.5, 1234.75, -11_000, 1, -1, 0.5, 4807.25, -0.5, 2000.25, 3000.75, 100, 200.5, 300.25, 400.125]);

/** Textbook byte-at-a-time CRC-32, to hold the slice-by-8 loop to. */
function slowCrc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

describe('encodeRgbaPng', () => {
  it('writes pixels the project decoder reads back identically', async () => {
    const rgba = Uint8Array.from({ length: SIZE * SIZE * 4 }, (_, i) => (i * 61 + (i % 5) * 43) & 255);
    const png = await decodePng(encodeRgbaPng(rgba, SIZE, SIZE));
    expect(png).toMatchObject({ width: SIZE, height: SIZE, channels: 4 });
    expect(Array.from(png.data)).toEqual(Array.from(rgba));
  });

  it('survives a terrarium round trip through the PNG container', async () => {
    const png = await decodePng(encodeRgbaPng(encodeTerrarium(heights, SIZE), SIZE, SIZE));
    const { elev } = decodeTerrarium(png.data, png.width, png.channels);
    for (let i = 0; i < heights.length; i++) expect(Math.abs(elev[i] - heights[i])).toBeLessThanOrEqual(1 / 256);
  });

  it('checksums whole slices and the tail alike', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(Uint8Array.from('123456789', (c) => c.charCodeAt(0)))).toBe(0xcbf43926);
    const bytes = Uint8Array.from({ length: 40 }, (_, i) => (i * 97) & 255);
    for (let n = 0; n <= bytes.length; n++) expect(crc32(bytes.subarray(0, n))).toBe(slowCrc32(bytes.subarray(0, n)));
  });

  it('splits a payload past the stored-block limit', async () => {
    const w = 64;
    const h = 300; // 77 KB of scanlines, so more than one stored block
    const rgba = Uint8Array.from({ length: w * h * 4 }, (_, i) => (i * 131 + (i % 11) * 17) & 255);
    const png = await decodePng(encodeRgbaPng(rgba, w, h));
    expect(Array.from(png.data)).toEqual(Array.from(rgba));
  });

  // A colour-managed PNG comes back off a least significant bit through canvas, which on red is 256 m.
  it('writes a signature, chunk CRCs and filter-0 scanlines, and no colour chunks', () => {
    const bytes = encodeRgbaPng(new Uint8Array(2 * 2 * 4), 2, 2);
    expect(Array.from(bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(bytes.buffer);
    const types: string[] = [];
    for (let pos = 8; pos + 12 <= bytes.length; ) {
      const len = view.getUint32(pos);
      types.push(String.fromCharCode(...bytes.subarray(pos + 4, pos + 8)));
      expect(crc32(bytes.subarray(pos + 4, pos + 8 + len))).toBe(view.getUint32(pos + 8 + len));
      pos += 12 + len;
    }
    expect(types).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(Array.from(bytes.subarray(16, 16 + 13))).toEqual([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
    // Zlib header then a final stored block: no compressor runs on the main thread.
    const idat = 8 + 12 + 13 + 8;
    expect(Array.from(bytes.subarray(idat, idat + 3))).toEqual([0x78, 0x01, 1]);
  });
});
