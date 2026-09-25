/** Synthetic paletted PNGs for tests: filter 0, CRCs left zero (the decoder skips them). */

import { deflateSync } from 'node:zlib';

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type: string, body: ArrayLike<number>) => [...be32(body.length), ...[...type].map((c) => c.charCodeAt(0)), ...Array.from(body), 0, 0, 0, 0];

/** 8-bit palette indices row by row; `palette: 0` leaves PLTE out, `colourType` overrides the header's. */
export function encodeIndexedPng(width: number, height: number, index: ArrayLike<number>, opts: { palette?: number; colourType?: number } = {}): Uint8Array {
  const raw = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = index[y * width + x];
  const colours = opts.palette ?? 256;
  const plte = colours ? chunk('PLTE', new Uint8Array(colours * 3)) : [];
  const ihdr = [...be32(width), ...be32(height), 8, opts.colourType ?? 3, 0, 0, 0];
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', ihdr), ...plte, ...chunk('IDAT', deflateSync(raw)), ...chunk('IEND', [])]);
}
