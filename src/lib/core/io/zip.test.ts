import { describe, expect, it } from 'vitest';
import { findZipEntry, isGzip, isZip, ZipMethod } from './zip';

/** A stored (uncompressed) zip of the given files, laid out as any archiver would. */
function zip(files: [string, string][]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let off = 0;
  for (const [name, text] of files) {
    const n = enc.encode(name);
    const d = enc.encode(text);
    const local = new Uint8Array(30 + n.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint32(18, d.length, true);
    lv.setUint32(22, d.length, true);
    lv.setUint16(26, n.length, true);
    local.set(n, 30);
    const cd = new Uint8Array(46 + n.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint32(20, d.length, true);
    cv.setUint32(24, d.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, off, true);
    cd.set(n, 46);
    parts.push(local, d);
    central.push(cd);
    off += local.length + d.length;
  }
  const cdLen = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdLen, true);
  ev.setUint32(16, off, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

describe('findZipEntry', () => {
  it('finds the wanted entry past others', () => {
    const z = zip([
      ['gsigeo/readme.pdf', 'pdf'],
      ['gsigeo/program/gsigeo2011_ver2_2.asc', 'grid text']
    ]);
    expect(isZip(z)).toBe(true);
    expect(isGzip(z)).toBe(false);
    const e = findZipEntry(z, (n) => n.endsWith('.asc'));
    expect(e?.name).toBe('gsigeo/program/gsigeo2011_ver2_2.asc');
    expect(e?.method).toBe(ZipMethod.Stored);
    expect(new TextDecoder().decode(e?.data)).toBe('grid text');
    expect(findZipEntry(z, (n) => n.endsWith('.isg'))).toBeNull();
  });

  it('rejects bytes without a zip directory', () => {
    expect(() => findZipEntry(new Uint8Array(64), () => true)).toThrow(/Not a readable zip/);
  });
});
