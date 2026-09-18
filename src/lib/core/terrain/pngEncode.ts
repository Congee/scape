/**
 * Minimal lossless RGBA8 PNG writer for DEM tiles: signature, IHDR, IDAT, IEND.
 * Canvas is not an option on the encode side either — one unit of red is 256 m — so the
 * bytes are written by hand, with every scanline on filter 0 to keep the writer trivial.
 */

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** Eight stacked CRC tables, each the previous one advanced by a byte, for the slice-by-8 loop. */
const CRC_TABLE = /* @__PURE__ */ (() => {
  const t = new Uint32Array(8 * 256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  for (let n = 0; n < 256; n++) {
    let c = t[n];
    for (let s = 1; s < 8; s++) {
      c = t[c & 255] ^ (c >>> 8);
      t[s * 256 + n] = c;
    }
  }
  return t;
})();

/**
 * Eight bytes at a time: a byte-at-a-time CRC costs 3 ms over a 512 px tile, which is most of the
 * encode's main-thread budget, and the eight lookups here have no dependency between them.
 */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  let i = 0;
  for (const end = bytes.length - 7; i < end; i += 8) {
    c ^= bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24);
    c =
      CRC_TABLE[7 * 256 + (c & 255)] ^
      CRC_TABLE[6 * 256 + ((c >>> 8) & 255)] ^
      CRC_TABLE[5 * 256 + ((c >>> 16) & 255)] ^
      CRC_TABLE[4 * 256 + (c >>> 24)] ^
      CRC_TABLE[3 * 256 + bytes[i + 4]] ^
      CRC_TABLE[2 * 256 + bytes[i + 5]] ^
      CRC_TABLE[256 + bytes[i + 6]] ^
      CRC_TABLE[bytes[i + 7]];
  }
  for (; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Length, type, body, CRC over type and body. */
function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(body.length + 8, crc32(out.subarray(4, body.length + 8)));
  return out;
}

/** Stored blocks carry LEN as a 16-bit count, so the payload is split at 64 KiB. */
const STORED_MAX = 0xffff;
const ADLER_BASE = 65521;

/**
 * Wraps `data` in a zlib stream of stored (uncompressed) deflate blocks: a memcpy and a checksum
 * rather than a compressor. These bytes never reach the network — MapLibre decodes them straight
 * from memory — so the size costs nothing, while `CompressionStream` blocked the main thread for
 * 22 ms a tile and a dozen tiles dropped a quarter second of frames.
 */
function storedZlib(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / STORED_MAX));
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let a = 1;
  let b = 0;
  let off = 2;
  for (let i = 0, n = 0; n < blocks; n++) {
    const len = Math.min(STORED_MAX, data.length - i);
    out[off++] = n === blocks - 1 ? 1 : 0; // final flag, block type 00, already byte-aligned
    out[off++] = len & 255;
    out[off++] = len >>> 8;
    out[off++] = ~len & 255;
    out[off++] = (~len >>> 8) & 255;
    out.set(data.subarray(i, i + len), off);
    // Checksummed off the copy while it is still hot, so the payload is walked once.
    for (const end = off + len; off < end; off++) {
      a += out[off];
      b += a;
      if (b >= 0xf0000000) {
        a %= ADLER_BASE;
        b %= ADLER_BASE;
      }
    }
    i += len;
  }
  a %= ADLER_BASE;
  b %= ADLER_BASE;
  new DataView(out.buffer).setUint32(off, ((b << 16) | a) >>> 0);
  return out;
}

/** Encodes `width * height * 4` RGBA bytes as a PNG, byte for byte. */
export function encodeRgbaPng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const idat = chunk('IDAT', storedZlib(raw));
  const head = chunk('IHDR', ihdr);
  const end = chunk('IEND', new Uint8Array(0));
  const out = new Uint8Array(SIGNATURE.length + head.length + idat.length + end.length);
  let off = 0;
  for (const part of [SIGNATURE, head, idat, end]) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}
