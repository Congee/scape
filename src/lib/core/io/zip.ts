/** Finds one entry in a zip archive through its central directory. Pure; inflating is the caller's. */

export const ZipMethod = { Stored: 0, Deflate: 8 } as const;
export type ZipMethod = (typeof ZipMethod)[keyof typeof ZipMethod];

export interface ZipEntry {
  name: string;
  method: ZipMethod;
  /** Compressed bytes, a view into the archive. */
  data: Uint8Array;
  size: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const EOCD64 = 0x06064b50;
const EOCD64_LOCATOR = 0x07064b50;
const ZIP64_EXTRA = 0x0001;
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

/** Little-endian u64 as a number; bytes past 2^53 cannot sit in a browser buffer anyway. */
function u64(dv: DataView, at: number): number {
  const hi = dv.getUint32(at + 4, true);
  if (hi >= 0x200000) throw new Error('Zip64 offset is out of range.');
  return hi * 0x100000000 + dv.getUint32(at, true);
}

/** Entry count and directory offset from the Zip64 end record the locator points at. */
function zip64End(dv: DataView, e: number): { count: number; dir: number } {
  const loc = e - 20;
  if (loc < 0 || dv.getUint32(loc, true) !== EOCD64_LOCATOR) throw new Error('Damaged Zip64 archive: no Zip64 end record locator.');
  const at = u64(dv, loc + 8);
  if (at + 56 > dv.byteLength || dv.getUint32(at, true) !== EOCD64) throw new Error('Damaged Zip64 archive: no Zip64 end record.');
  return { count: u64(dv, at + 32), dir: u64(dv, at + 48) };
}

/** Replaces the 0xFFFFFFFF fields of a central entry from its Zip64 extra field, in the spec's order. */
function zip64Fields(dv: DataView, extra: number, extraLen: number, f: { size: number; csize: number; local: number }) {
  for (let q = extra; q + 4 <= extra + extraLen; q += 4 + dv.getUint16(q + 2, true)) {
    if (dv.getUint16(q, true) !== ZIP64_EXTRA) continue;
    let r = q + 4;
    const end = r + dv.getUint16(q + 2, true);
    const take = () => {
      if (r + 8 > end) throw new Error('Damaged zip entry: short Zip64 extra field.');
      const v = u64(dv, r);
      r += 8;
      return v;
    };
    if (f.size === U32_MAX) f.size = take();
    if (f.csize === U32_MAX) f.csize = take();
    if (f.local === U32_MAX) f.local = take();
    return;
  }
  throw new Error('Damaged zip entry: Zip64 sizes without a Zip64 extra field.');
}

export const isZip = (b: Uint8Array): boolean => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;
export const isGzip = (b: Uint8Array): boolean => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;

/** The first entry whose name passes `want`; null when none does. Reads Zip64; throws on a damaged archive. */
export function findZipEntry(b: Uint8Array, want: (name: string) => boolean): ZipEntry | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = -1;
  // The end record sits in the last 64 KiB + 22 bytes (its comment is at most 64 KiB).
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--)
    if (dv.getUint32(i, true) === EOCD) {
      e = i;
      break;
    }
  if (e < 0) throw new Error('Not a readable zip file.');
  let count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  if (count === U16_MAX || p === U32_MAX || dv.getUint32(e + 12, true) === U32_MAX) ({ count, dir: p } = zip64End(dv, e));
  const latin = new TextDecoder('latin1');
  for (let k = 0; k < count; k++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== CENTRAL) throw new Error('Damaged zip directory.');
    const method = dv.getUint16(p + 10, true);
    const f = { csize: dv.getUint32(p + 20, true), size: dv.getUint32(p + 24, true), local: dv.getUint32(p + 42, true) };
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const next = p + 46 + nameLen + extraLen + dv.getUint16(p + 32, true);
    if (next > b.length) throw new Error('Damaged zip directory.');
    if (f.csize === U32_MAX || f.size === U32_MAX || f.local === U32_MAX) zip64Fields(dv, p + 46 + nameLen, extraLen, f);
    // GSI's archives store non-ASCII names without the UTF-8 flag; ASCII names read the same either way.
    const name = latin.decode(b.subarray(p + 46, p + 46 + nameLen));
    p = next;
    if (!want(name)) continue;
    if (method !== ZipMethod.Stored && method !== ZipMethod.Deflate) throw new Error(`Zip compression method ${method} is not supported.`);
    if (f.local + 30 > b.length || dv.getUint32(f.local, true) !== LOCAL) throw new Error('Damaged zip entry.');
    const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
    if (start + f.csize > b.length) throw new Error('Damaged zip entry: data runs past the end of the file.');
    return { name, method, data: b.subarray(start, start + f.csize), size: f.size };
  }
  return null;
}
