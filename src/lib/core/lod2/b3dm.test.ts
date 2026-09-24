import { describe, expect, it } from 'vitest';
import { GltfError } from '@core/model/gltf';
import { isB3dm, readB3dm } from './b3dm';

/** JSON padded with spaces to 8 bytes, as b3dm tables are. */
function padded(o: object): Uint8Array {
  const s = new TextEncoder().encode(JSON.stringify(o));
  const out = new Uint8Array((s.length + 7) & ~7).fill(0x20);
  out.set(s);
  return out;
}

function b3dm(ft: object, bt: object, glb: Uint8Array, version = 1): ArrayBuffer {
  const f = padded(ft);
  const b = padded(bt);
  const total = 28 + f.length + b.length + glb.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode('b3dm'));
  dv.setUint32(4, version, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, f.length, true);
  dv.setUint32(20, b.length, true);
  out.set(f, 28);
  out.set(b, 28 + f.length);
  out.set(glb, 28 + f.length + b.length);
  return out.buffer;
}

describe('readB3dm', () => {
  it('splits out the GLB, RTC centre and JSON batch columns', () => {
    const buf = b3dm({ BATCH_LENGTH: 2, RTC_CENTER: [1, 2, 3] }, { id: ['a', 'b'], h: [1.5, null], bin: { byteOffset: 0 } }, new Uint8Array([7, 8, 9, 10]));
    expect(isB3dm(buf)).toBe(true);
    const t = readB3dm(buf);
    expect(Array.from(new Uint8Array(t.glb))).toEqual([7, 8, 9, 10]);
    expect(t.rtc).toEqual([1, 2, 3]);
    expect(t.batch).toEqual({ id: ['a', 'b'], h: [1.5, null] });
  });

  it('leaves the RTC centre out when the feature table has none', () => {
    expect(readB3dm(b3dm({ BATCH_LENGTH: 0 }, {}, new Uint8Array(4))).rtc).toBeUndefined();
  });

  it('rejects other magic, versions and lengths', () => {
    expect(isB3dm(new Uint8Array([0x67, 0x6c, 0x54, 0x46]).buffer)).toBe(false);
    expect(() => readB3dm(new ArrayBuffer(8))).toThrow(GltfError);
    expect(() => readB3dm(b3dm({}, {}, new Uint8Array(4), 2))).toThrow('version 2');
    const short = b3dm({}, {}, new Uint8Array(4));
    new DataView(short).setUint32(8, 9999, true);
    expect(() => readB3dm(short)).toThrow('length');
  });
});
