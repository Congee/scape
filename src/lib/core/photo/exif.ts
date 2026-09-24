/** Just enough JPEG Exif to read the 35 mm-equivalent focal length. */

const EXIF_IFD = 0x8769;
const FOCAL_35 = 0xa405;
const SHORT = 3;
const LONG = 4;

/** `FocalLengthIn35mmFilm` in mm, or null when the file is not a JPEG or does not say. */
export function focal35FromJpeg(bytes: Uint8Array): number | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let i = 2;
  while (i + 4 <= v.byteLength) {
    if (v.getUint8(i) !== 0xff) return null;
    const m = v.getUint8(i + 1);
    if (m === 0xff) {
      i++;
      continue;
    }
    // Start of scan or end of image: Exif always comes before either.
    if (m === 0xda || m === 0xd9) return null;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = v.getUint16(i + 2);
    if (len < 2 || i + 2 + len > v.byteLength) return null;
    if (m === 0xe1 && len >= 16 && v.getUint32(i + 4) === 0x45786966 && v.getUint16(i + 8) === 0) {
      const f = focal35FromTiff(new DataView(v.buffer, v.byteOffset + i + 10, len - 8));
      if (f != null) return f;
    }
    i += 2 + len;
  }
  return null;
}

function focal35FromTiff(t: DataView): number | null {
  if (t.byteLength < 8) return null;
  const order = t.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const le = order === 0x4949;
  if (t.getUint16(2, le) !== 42) return null;
  const exif = entry(t, t.getUint32(4, le), EXIF_IFD, le);
  if (!exif || exif.type !== LONG) return null;
  const f = entry(t, t.getUint32(exif.at, le), FOCAL_35, le);
  if (!f || f.type !== SHORT) return null;
  const mm = t.getUint16(f.at, le);
  return mm > 0 ? mm : null;
}

/** Type and value-field offset of one tag in an IFD, bounds-checked. */
function entry(t: DataView, ifd: number, tag: number, le: boolean): { type: number; at: number } | null {
  if (ifd < 8 || ifd + 2 > t.byteLength) return null;
  const n = t.getUint16(ifd, le);
  for (let k = 0; k < n; k++) {
    const o = ifd + 2 + k * 12;
    if (o + 12 > t.byteLength) return null;
    if (t.getUint16(o, le) === tag) return { type: t.getUint16(o + 2, le), at: o + 8 };
  }
  return null;
}
