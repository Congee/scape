/**
 * Minimal PNG decoder for DEM tiles: 8-bit, non-interlaced grey/RGB(A).
 * Canvas decoding is not lossless (colour management nudges channel values), and in
 * Terrarium one unit of red is 256 m, so the bytes are decoded by hand.
 */

export interface DecodedPng {
  width: number;
  height: number;
  /** Samples per pixel: 1 grey, 2 grey+alpha, 3 RGB, 4 RGBA. */
  channels: 1 | 2 | 3 | 4;
  /** Unfiltered rows, `width * channels` bytes each. */
  data: Uint8Array;
}

export class UnsupportedPngError extends Error {}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS: Record<number, 1 | 2 | 3 | 4 | undefined> = { 0: 1, 2: 3, 4: 2, 6: 4 };

async function inflate(zlibData: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  // Corrupt data rejects these too; the read below reports it.
  writer.write(zlibData).catch(() => {});
  writer.close().catch(() => {});
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Reverses the per-row PNG filters in place. */
export function unfilter(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  for (let y = 0, src = 0, dst = 0; y < height; y++, dst += stride) {
    const filter = raw[src++];
    const prev = dst - stride;
    for (let i = 0; i < stride; i++, src++) {
      const x = raw[src];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = y > 0 ? out[prev + i] : 0;
      const c = y > 0 && i >= bpp ? out[prev + i - bpp] : 0;
      let v: number;
      switch (filter) {
        case 0:
          v = x;
          break;
        case 1:
          v = x + a;
          break;
        case 2:
          v = x + b;
          break;
        case 3:
          v = x + ((a + b) >> 1);
          break;
        case 4:
          v = x + paeth(a, b, c);
          break;
        default:
          throw new UnsupportedPngError(`PNG filter ${filter}`);
      }
      out[dst + i] = v & 255;
    }
  }
  return out;
}

interface Chunks {
  width: number;
  height: number;
  depth: number;
  colourType: number;
  interlace: number;
  /** PLTE entries, 0 without a palette. */
  paletteSize: number;
  zlib: Uint8Array<ArrayBuffer>;
}

function readChunks(bytes: Uint8Array): Chunks {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new UnsupportedPngError('Not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const c = { width: 0, height: 0, depth: 0, colourType: 0, interlace: 0, paletteSize: 0 };
  const idat: Uint8Array[] = [];
  let total = 0;
  for (let pos = 8; pos + 8 <= bytes.length; ) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const body = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      c.width = view.getUint32(pos + 8);
      c.height = view.getUint32(pos + 12);
      c.depth = bytes[pos + 16];
      c.colourType = bytes[pos + 17];
      c.interlace = bytes[pos + 20];
    } else if (type === 'PLTE') c.paletteSize = Math.floor(len / 3);
    else if (type === 'IDAT') {
      idat.push(body);
      total += body.length;
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!c.width || !c.height) throw new UnsupportedPngError('PNG without IHDR');
  const zlib = new Uint8Array(total);
  for (let i = 0, off = 0; i < idat.length; off += idat[i].length, i++) zlib.set(idat[i], off);
  return { ...c, zlib };
}

async function pixels(c: Chunks, bpp: number): Promise<Uint8Array> {
  const raw = await inflate(c.zlib);
  if (raw.length < c.height * (c.width * bpp + 1)) throw new UnsupportedPngError('PNG data truncated');
  return unfilter(raw, c.width, c.height, bpp);
}

export async function decodePng(bytes: Uint8Array): Promise<DecodedPng> {
  const c = readChunks(bytes);
  const channels = CHANNELS[c.colourType];
  if (c.depth !== 8 || !channels || c.interlace !== 0) throw new UnsupportedPngError(`PNG depth ${c.depth}, colour type ${c.colourType}, interlace ${c.interlace}`);
  return { width: c.width, height: c.height, channels, data: await pixels(c, channels) };
}

export interface IndexedPng {
  width: number;
  height: number;
  /** Palette index per pixel, row-major. */
  index: Uint8Array;
  paletteSize: number;
}

/** 8-bit paletted (colour type 3) PNGs, whose indices carry the data (GIBS colormap refs). */
export async function decodeIndexedPng(bytes: Uint8Array): Promise<IndexedPng> {
  const c = readChunks(bytes);
  if (c.depth !== 8 || c.colourType !== 3 || c.interlace !== 0 || !c.paletteSize) throw new UnsupportedPngError(`PNG depth ${c.depth}, colour type ${c.colourType}, interlace ${c.interlace}, palette ${c.paletteSize}`);
  return { width: c.width, height: c.height, index: await pixels(c, 1), paletteSize: c.paletteSize };
}
