import { describe, expect, it } from 'vitest';
import { focal35FromJpeg } from './exif';

/** A JPEG head: SOI, a JFIF APP0, an Exif APP1 whose Exif IFD holds `tags`, then SOS. */
function jpeg(tags: [tag: number, type: number, value: number][], le: boolean): Uint8Array {
  const ifd0 = 8;
  const exifIfd = ifd0 + 2 + 12 + 4;
  const tiff = new DataView(new ArrayBuffer(exifIfd + 2 + tags.length * 12 + 4));
  tiff.setUint16(0, le ? 0x4949 : 0x4d4d);
  tiff.setUint16(2, 42, le);
  tiff.setUint32(4, ifd0, le);
  tiff.setUint16(ifd0, 1, le);
  tiff.setUint16(ifd0 + 2, 0x8769, le);
  tiff.setUint16(ifd0 + 4, 4, le);
  tiff.setUint32(ifd0 + 6, 1, le);
  tiff.setUint32(ifd0 + 10, exifIfd, le);
  tiff.setUint16(exifIfd, tags.length, le);
  tags.forEach(([tag, type, value], k) => {
    const o = exifIfd + 2 + k * 12;
    tiff.setUint16(o, tag, le);
    tiff.setUint16(o + 2, type, le);
    tiff.setUint32(o + 4, 1, le);
    if (type === 3) tiff.setUint16(o + 8, value, le);
    else tiff.setUint32(o + 8, value, le);
  });
  const app1 = [0xff, 0xe1, 0, 0, 0x45, 0x78, 0x69, 0x66, 0, 0, ...new Uint8Array(tiff.buffer)];
  const len = app1.length - 2;
  app1[2] = len >> 8;
  app1[3] = len & 0xff;
  const app0 = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...app1, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
}

describe('focal35FromJpeg', () => {
  it('reads FocalLengthIn35mmFilm in both byte orders', () => {
    for (const le of [true, false]) {
      expect(focal35FromJpeg(jpeg([[0x829a, 5, 0], [0xa405, 3, 50]], le))).toBe(50);
      expect(focal35FromJpeg(jpeg([[0xa405, 3, 600]], le))).toBe(600);
    }
  });

  it('returns null when the tag is missing, zero or mistyped', () => {
    expect(focal35FromJpeg(jpeg([[0x920a, 5, 0]], true))).toBeNull();
    expect(focal35FromJpeg(jpeg([[0xa405, 3, 0]], true))).toBeNull();
    expect(focal35FromJpeg(jpeg([[0xa405, 4, 50]], true))).toBeNull();
  });

  it('returns null for non-JPEGs and truncated files', () => {
    expect(focal35FromJpeg(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(focal35FromJpeg(new Uint8Array(0))).toBeNull();
    const full = jpeg([[0xa405, 3, 50]], true);
    for (const n of [3, 10, 24, 40, 60]) expect(focal35FromJpeg(full.subarray(0, n))).toBeNull();
  });

  it('survives a bogus IFD offset', () => {
    const bytes = jpeg([[0xa405, 3, 50]], true);
    // TIFF header starts after SOI (2), APP0 (18) and the APP1 marker, length and Exif id (10).
    new DataView(bytes.buffer).setUint32(30 + 4, 0xfffffff0, true);
    expect(focal35FromJpeg(bytes)).toBeNull();
  });
});
