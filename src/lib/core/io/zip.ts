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

export const isZip = (b: Uint8Array): boolean => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;
export const isGzip = (b: Uint8Array): boolean => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;

/** The first entry whose name passes `want`; null when none does. Throws on a damaged or Zip64 archive. */
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
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  if (p === 0xffffffff) throw new Error('Zip64 archives are not supported; unzip it and import the file inside.');
  const latin = new TextDecoder('latin1');
  for (let k = 0; k < count; k++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== CENTRAL) throw new Error('Damaged zip directory.');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const next = p + 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    // GSI's archives store Shift-JIS names without the UTF-8 flag; ASCII names read the same either way.
    const name = latin.decode(b.subarray(p + 46, p + 46 + nameLen));
    p = next;
    if (!want(name)) continue;
    if (method !== ZipMethod.Stored && method !== ZipMethod.Deflate) throw new Error(`Zip compression method ${method} is not supported.`);
    if (dv.getUint32(local, true) !== LOCAL) throw new Error('Damaged zip entry.');
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    return { name, method, data: b.subarray(start, start + csize), size };
  }
  return null;
}
