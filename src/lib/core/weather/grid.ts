/** A global lat/lng lattice of cloud cells; cell centres sit on multiples of `step`, so pans reuse cached cells. */
export interface Lattice {
  step: number;
  /** Centre of cell (0, 0), south-west. */
  lat0: number;
  lng0: number;
  cols: number;
  rows: number;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

const KM_PER_DEG = 111.2;
const BASE_STEP = 0.01;
/** At most this many cells across the viewport's longer side. */
export const MAX_CELLS = 8;
const MAX_LAT = 85;

/** Coarsest-needed lattice step: at most MAX_CELLS across, never finer than the model grid. */
export function latticeStep(b: Bounds, minKm: number): number {
  const span = Math.max(b.east - b.west, b.north - b.south);
  let step = BASE_STEP;
  while (step < 90 && (span / step > MAX_CELLS || step * KM_PER_DEG < minKm)) step *= 2;
  return step;
}

/** Cells covering `b` with one spare ring, so the bilinear edge reaches the viewport edge. */
export function lattice(b: Bounds, minKm: number): Lattice {
  const step = latticeStep(b, minKm);
  const i0 = Math.floor(b.west / step) - 1;
  const i1 = Math.ceil(b.east / step) + 1;
  const j0 = Math.max(Math.floor(b.south / step) - 1, Math.ceil(-MAX_LAT / step));
  const j1 = Math.min(Math.ceil(b.north / step) + 1, Math.floor(MAX_LAT / step));
  return { step, lat0: j0 * step, lng0: i0 * step, cols: i1 - i0 + 1, rows: Math.max(1, j1 - j0 + 1) };
}

/** Cell centres, row-major from the south-west; longitudes wrapped to [-180, 180). */
export function cellPoints(l: Lattice): { lat: number; lng: number }[] {
  const out: { lat: number; lng: number }[] = [];
  for (let j = 0; j < l.rows; j++)
    for (let i = 0; i < l.cols; i++) {
      const lng = l.lng0 + i * l.step;
      out.push({ lat: round(l.lat0 + j * l.step), lng: round(((((lng + 180) % 360) + 360) % 360) - 180) });
    }
  return out;
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** Image corners (NW, NE, SE, SW) offset half a cell so pixel centres line up with cell centres. */
export function latticeCorners(l: Lattice): [[number, number], [number, number], [number, number], [number, number]] {
  const h = l.step / 2;
  const w = l.lng0 - h;
  const e = l.lng0 + (l.cols - 1) * l.step + h;
  const s = Math.max(-MAX_LAT, l.lat0 - h);
  const n = Math.min(MAX_LAT, l.lat0 + (l.rows - 1) * l.step + h);
  return [
    [w, n],
    [e, n],
    [e, s],
    [w, s]
  ];
}

/** Bilinear at fractional cell (fx, fy); NaN when any contributing corner is missing, so gaps never read as clear. */
export function bilinear(v: ArrayLike<number>, cols: number, rows: number, fx: number, fy: number): number {
  const x = Math.min(Math.max(fx, 0), cols - 1);
  const y = Math.min(Math.max(fy, 0), rows - 1);
  const i = Math.min(Math.floor(x), cols - 2 < 0 ? 0 : cols - 2);
  const j = Math.min(Math.floor(y), rows - 2 < 0 ? 0 : rows - 2);
  const tx = cols > 1 ? x - i : 0;
  const ty = rows > 1 ? y - j : 0;
  const at = (a: number, b: number) => v[Math.min(b, rows - 1) * cols + Math.min(a, cols - 1)];
  const w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
  const c = [at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)];
  let sum = 0;
  for (let k = 0; k < 4; k++) {
    if (w[k] === 0) continue;
    if (Number.isNaN(c[k])) return NaN;
    sum += w[k] * c[k];
  }
  return sum;
}

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const unMercY = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;

/** Red, green, blue 0..255 with an alpha 0..1. */
export type Rgba = readonly [number, number, number, number];

/**
 * Paints `v` (one value per cell, row-major from the south-west) into a Mercator-row RGBA image of `px` pixels per cell.
 * `color` maps an interpolated value to a colour; NaN pixels get the `gap` hatch.
 * Premultiplied: MapLibre uploads ImageData as-is and blends it as premultiplied.
 */
export function paintLattice(l: Lattice, v: ArrayLike<number>, px: number, color: (x: number) => Rgba, gap: (x: number, y: number) => Rgba): { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> } {
  const [[, n], , [, s]] = latticeCorners(l);
  const width = l.cols * px;
  const height = Math.max(1, l.rows * px);
  const data = new Uint8ClampedArray(width * height * 4);
  const yn = mercY(n);
  const ys = mercY(s);
  const west = l.lng0 - l.step / 2;
  for (let y = 0; y < height; y++) {
    const lat = unMercY(yn + ((y + 0.5) / height) * (ys - yn));
    const fy = (lat - l.lat0) / l.step;
    for (let x = 0; x < width; x++) {
      const lng = west + ((x + 0.5) / width) * l.cols * l.step;
      const val = bilinear(v, l.cols, l.rows, (lng - l.lng0) / l.step, fy);
      const [r, g, b, a] = Number.isNaN(val) ? gap(x, y) : color(val);
      const p = (y * width + x) * 4;
      data[p] = r * a;
      data[p + 1] = g * a;
      data[p + 2] = b * a;
      data[p + 3] = Math.round(a * 255);
    }
  }
  return { width, height, data };
}
