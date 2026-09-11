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
  void writer.write(zlibData);
  void writer.close();
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

export async function decodePng(bytes: Uint8Array): Promise<DecodedPng> {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new UnsupportedPngError('Not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let channels: 1 | 2 | 3 | 4 = 4;
  const idat: Uint8Array[] = [];
  let total = 0;
  for (let pos = 8; pos + 8 <= bytes.length; ) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const body = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      const depth = bytes[pos + 16];
      const ch = CHANNELS[bytes[pos + 17]];
      const interlace = bytes[pos + 20];
      if (depth !== 8 || !ch || interlace !== 0) throw new UnsupportedPngError(`PNG depth ${depth}, colour type ${bytes[pos + 17]}, interlace ${interlace}`);
      channels = ch;
    } else if (type === 'IDAT') {
      idat.push(body);
      total += body.length;
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!width || !height) throw new UnsupportedPngError('PNG without IHDR');
  const zlibData = new Uint8Array(total);
  for (let i = 0, off = 0; i < idat.length; off += idat[i].length, i++) zlibData.set(idat[i], off);
  const raw = await inflate(zlibData);
  if (raw.length < height * (width * channels + 1)) throw new UnsupportedPngError('PNG data truncated');
  return { width, height, channels, data: unfilter(raw, width, height, channels) };
}
