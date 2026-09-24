import { describe, expect, it } from 'vitest';
import { findZipEntry, isGzip, isZip, ZipMethod } from './zip';

const Z64 = { None: 'None', Full: 'Full', NoExtra: 'NoExtra', NoLocator: 'NoLocator' } as const;
type Z64 = (typeof Z64)[keyof typeof Z64];

/** A stored (uncompressed) zip of the given files, laid out as any archiver would; Zip64 puts every size and offset in 64-bit fields. */
function zip(files: [string, string][], z64: Z64 = Z64.None): Uint8Array {
  const wide = z64 !== Z64.None;
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
    const extra = z64 === Z64.Full ? 4 + 24 : 0;
    const cd = new Uint8Array(46 + n.length + extra);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint32(20, wide ? 0xffffffff : d.length, true);
    cv.setUint32(24, wide ? 0xffffffff : d.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint16(30, extra, true);
    cv.setUint32(42, wide ? 0xffffffff : off, true);
    cd.set(n, 46);
    if (extra) {
      const x = 46 + n.length;
      cv.setUint16(x, 0x0001, true);
      cv.setUint16(x + 2, 24, true);
      cv.setUint32(x + 4, d.length, true);
      cv.setUint32(x + 12, d.length, true);
      cv.setUint32(x + 20, off, true);
    }
    parts.push(local, d);
    central.push(cd);
    off += local.length + d.length;
  }
  const cdLen = central.reduce((a, c) => a + c.length, 0);
  const tail: Uint8Array[] = [];
  if (wide) {
    const rec = new Uint8Array(56);
    const rv = new DataView(rec.buffer);
    rv.setUint32(0, 0x06064b50, true);
    rv.setUint32(4, 44, true);
    rv.setUint32(24, files.length, true);
    rv.setUint32(32, files.length, true);
    rv.setUint32(40, cdLen, true);
    rv.setUint32(48, off, true);
    const loc = new Uint8Array(20);
    const lv = new DataView(loc.buffer);
    lv.setUint32(0, 0x07064b50, true);
    lv.setUint32(8, off + cdLen, true);
    lv.setUint32(16, 1, true);
    tail.push(rec);
    if (z64 !== Z64.NoLocator) tail.push(loc);
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, wide ? 0xffff : files.length, true);
  ev.setUint16(10, wide ? 0xffff : files.length, true);
  ev.setUint32(12, wide ? 0xffffffff : cdLen, true);
  ev.setUint32(16, wide ? 0xffffffff : off, true);
  const all = [...parts, ...central, ...tail, end];
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

  it('reads Zip64 sizes and offsets from the 64-bit records', () => {
    const z = zip(
      [
        ['a.txt', 'first'],
        ['b.asc', 'second entry']
      ],
      Z64.Full
    );
    const e = findZipEntry(z, (n) => n.endsWith('.asc'));
    expect(e?.name).toBe('b.asc');
    expect(e?.size).toBe(12);
    expect(new TextDecoder().decode(e?.data)).toBe('second entry');
  });

  it('fails loudly on Zip64 markers without their records', () => {
    expect(() => findZipEntry(zip([['a.asc', 'x']], Z64.NoLocator), () => true)).toThrow(/no Zip64 end record locator/);
    expect(() => findZipEntry(zip([['a.asc', 'x']], Z64.NoExtra), () => true)).toThrow(/without a Zip64 extra field/);
  });

  it('rejects an entry whose data runs past the file', () => {
    const z = zip([['a.asc', 'data']]);
    new DataView(z.buffer).setUint32(z.length - 22 - 46 - 5 + 20, 1000, true);
    expect(() => findZipEntry(z, () => true)).toThrow(/runs past the end/);
  });

  it('rejects bytes without a zip directory', () => {
    expect(() => findZipEntry(new Uint8Array(64), () => true)).toThrow(/Not a readable zip/);
  });
});
