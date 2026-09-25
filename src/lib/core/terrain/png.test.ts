import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeTerrarium } from './dem';
import { decodeIndexedPng, decodePng, UnsupportedPngError } from './png';
import { encodeIndexedPng } from './pngFixture';

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type: string, body: number[]) => [...be32(body.length), ...[...type].map((c) => c.charCodeAt(0)), ...body, 0, 0, 0, 0];

/** Encodes 8-bit RGB pixels row by row with the given filter per row (CRCs left zero; the decoder skips them). */
function encodePng(width: number, height: number, rgb: number[], filters: number[]): Uint8Array {
  const bpp = 3;
  const stride = width * bpp;
  const raw: number[] = [];
  for (let y = 0; y < height; y++) {
    const f = filters[y];
    raw.push(f);
    for (let i = 0; i < stride; i++) {
      const x = rgb[y * stride + i];
      const a = i >= bpp ? rgb[y * stride + i - bpp] : 0;
      const b = y > 0 ? rgb[(y - 1) * stride + i] : 0;
      const c = y > 0 && i >= bpp ? rgb[(y - 1) * stride + i - bpp] : 0;
      const p = a + b - c;
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      raw.push((x - pred) & 255);
    }
  }
  const idat = [...deflateSync(Buffer.from(raw))];
  const ihdr = [...be32(width), ...be32(height), 8, 2, 0, 0, 0];
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', ihdr), ...chunk('IDAT', idat.slice(0, 7)), ...chunk('IDAT', idat.slice(7)), ...chunk('IEND', [])]);
}

describe('decodePng', () => {
  const w = 4;
  const h = 5;
  const rgb = Array.from({ length: w * h * 3 }, (_, i) => (i * 37 + (i % 7) * 101) & 255);

  it('reverses every filter type and joins split IDAT chunks', async () => {
    const png = await decodePng(encodePng(w, h, rgb, [0, 1, 2, 3, 4]));
    expect(png).toMatchObject({ width: w, height: h, channels: 3 });
    expect(Array.from(png.data)).toEqual(rgb);
  });

  it('feeds Terrarium decoding without an alpha channel', async () => {
    const png = await decodePng(encodePng(2, 1, [128, 0, 0, 132, 184, 64], [4]));
    const { elev: e } = decodeTerrarium(png.data, 2, png.channels);
    expect(e[0]).toBe(0);
    expect(e[1]).toBeCloseTo(1208.25, 6);
  });

  it('rejects what it cannot decode', async () => {
    await expect(decodePng(Uint8Array.from([1, 2, 3]))).rejects.toBeInstanceOf(UnsupportedPngError);
    const interlaced = encodePng(1, 1, [1, 2, 3], [0]);
    interlaced[8 + 8 + 12] = 1;
    await expect(decodePng(interlaced)).rejects.toBeInstanceOf(UnsupportedPngError);
  });
});

describe('decodeIndexedPng', () => {
  const index = Array.from({ length: 6 * 3 }, (_, i) => (i * 29) % 181);

  it('returns raw palette indices', async () => {
    const png = await decodeIndexedPng(encodeIndexedPng(6, 3, index, { palette: 181 }));
    expect(png).toMatchObject({ width: 6, height: 3, paletteSize: 181 });
    expect(Array.from(png.index)).toEqual(index);
  });

  it('rejects unpaletted or palette-less images', async () => {
    await expect(decodeIndexedPng(encodeIndexedPng(6, 3, index, { palette: 0 }))).rejects.toBeInstanceOf(UnsupportedPngError);
    await expect(decodeIndexedPng(encodePng(1, 1, [1, 2, 3], [0]))).rejects.toBeInstanceOf(UnsupportedPngError);
  });

  it('rejects truncated data', async () => {
    const png = encodeIndexedPng(6, 3, index);
    await expect(decodeIndexedPng(png.slice(0, png.length - 20))).rejects.toThrow();
  });
});
