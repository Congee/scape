const D2R = Math.PI / 180;
const MAGIC = 0x31594b53; // 'SKY1' little-endian
const RECORD_BYTES = 12;

export interface StarRecord {
  raDeg: number;
  decDeg: number;
  mag: number;
  /** B−V colour index. */
  ci: number;
}

/** Bright-star catalogue (J2000), brightest first so a prefix is a coarser level of detail. */
export interface StarCatalog {
  n: number;
  /** Equatorial J2000 unit vectors: x toward RA 0h, z toward the north celestial pole. */
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  raDeg: Float32Array;
  decDeg: Float32Array;
  mag: Float32Array;
  /** sRGB per star, 3 bytes each. */
  rgb: Uint8ClampedArray;
  names: Map<number, string>;
}

/** Polaris, J2000. */
export const POLARIS = { raDeg: 37.95456, decDeg: 89.26411, mag: 1.98 };

export function eqjVector(raDeg: number, decDeg: number): [number, number, number] {
  const ra = raDeg * D2R;
  const dec = decDeg * D2R;
  const c = Math.cos(dec);
  return [Math.cos(ra) * c, Math.sin(ra) * c, Math.sin(dec)];
}

export function encodeStarCatalog(stars: StarRecord[]): ArrayBuffer {
  const buf = new ArrayBuffer(8 + stars.length * RECORD_BYTES);
  const v = new DataView(buf);
  v.setUint32(0, MAGIC, true);
  v.setUint32(4, stars.length, true);
  stars.forEach((s, i) => {
    const o = 8 + i * RECORD_BYTES;
    v.setFloat32(o, s.raDeg * D2R, true);
    v.setFloat32(o + 4, s.decDeg * D2R, true);
    v.setInt16(o + 8, Math.round(s.mag * 100), true);
    v.setInt16(o + 10, Math.round(s.ci * 100), true);
  });
  return buf;
}

export function parseStarCatalog(buf: ArrayBuffer, names: [number, string][] = []): StarCatalog {
  const v = new DataView(buf);
  if (v.getUint32(0, true) !== MAGIC) throw new Error('Not a star catalogue');
  const n = v.getUint32(4, true);
  const cat: StarCatalog = {
    n,
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    raDeg: new Float32Array(n),
    decDeg: new Float32Array(n),
    mag: new Float32Array(n),
    rgb: new Uint8ClampedArray(n * 3),
    names: new Map(names)
  };
  for (let i = 0; i < n; i++) {
    const o = 8 + i * RECORD_BYTES;
    const ra = v.getFloat32(o, true);
    const dec = v.getFloat32(o + 4, true);
    const c = Math.cos(dec);
    cat.x[i] = Math.cos(ra) * c;
    cat.y[i] = Math.sin(ra) * c;
    cat.z[i] = Math.sin(dec);
    cat.raDeg[i] = ra / D2R;
    cat.decDeg[i] = dec / D2R;
    cat.mag[i] = v.getInt16(o + 8, true) / 100;
    const [r, g, b] = starColor(v.getInt16(o + 10, true) / 100);
    cat.rgb[i * 3] = r;
    cat.rgb[i * 3 + 1] = g;
    cat.rgb[i * 3 + 2] = b;
  }
  return cat;
}

const soften = (v: number) => Math.round(255 * 0.55 + Math.min(255, Math.max(0, v)) * 0.45);

/** Ballesteros' B−V to temperature, then a black-body tint softened toward white. */
export function starColor(ci: number): [number, number, number] {
  const bv = Math.min(2, Math.max(-0.4, ci));
  const t = (4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708 * Math.log(t) - 161.1196;
    b = t <= 19 ? 0 : 138.5177 * Math.log(t - 10) - 305.0448;
  } else {
    r = 329.6987 * (t - 60) ** -0.1332;
    g = 288.1222 * (t - 60) ** -0.0755;
    b = 255;
  }
  return [soften(r), soften(g), soften(b)];
}

/** On-screen radius at 1× pixel ratio; the eye's response to magnitude is roughly this steep. */
export function starRadiusPx(mag: number): number {
  return Math.min(3.4, Math.max(0.55, 2.8 - 0.42 * mag));
}

export function starAlpha(mag: number): number {
  return Math.min(1, Math.max(0.25, 1.1 - 0.12 * mag));
}
