/** GSI's GSIGEO2011 ASCII geoid grid (Ver.2.1, Ver.2.2) and GSI's own bilinear interpolation. Pure. */

export const GeoidVersion = { V21: 'Ver.2.1', V22: 'Ver.2.2' } as const;
export type GeoidVersion = (typeof GeoidVersion)[keyof typeof GeoidVersion];

const VERSION_TOKENS: Readonly<Record<string, GeoidVersion>> = { 'ver2.1': GeoidVersion.V21, 'ver2.2': GeoidVersion.V22 };

export interface GeoidHeader {
  /** South-west node, degrees. */
  lat0: number;
  lng0: number;
  /** Node spacing, degrees. */
  dLat: number;
  dLng: number;
  rows: number;
  cols: number;
  version: GeoidVersion;
}

export interface GeoidGrid extends GeoidHeader {
  /** Geoid height per node, metres, rows from the south, each row west to east; NaN where GSI has no data. */
  n: Float32Array;
}

const NO_DATA = 999;
/** GSI's `el2`: a point this close to a grid line, in cells, lies on it. */
const EL2 = 1e-5;

/** The header rounds 1′ to 0.016667°; GSI's program uses the exact spacing, so snap to 0.01″. */
const snapDeg = (d: number): number => Math.round(d * 360_000) / 360_000;

const NOT_GSIGEO = 'Not a GSIGEO2011 .asc file. Import GSI’s “日本のジオイド2011” Ver.2.1 or Ver.2.2 (gsigeo2011_ver2_x.asc or its .zip).';

/** The first line: `glamn glomn dgla dglo nla nlo ikind version`. */
export function parseGeoidHeader(line: string): GeoidHeader {
  if (/begin_of_head/i.test(line)) throw new Error('This is an ISG file (e.g. JPGEO2024), not GSIGEO2011. PLATEAU heights use GSIGEO2011 Ver.2.1 or Ver.2.2.');
  const t = line.trim().split(/\s+/);
  const num = t.slice(0, 7).map(Number);
  if (t.length < 7 || num.some((v) => !Number.isFinite(v))) throw new Error(NOT_GSIGEO);
  const [lat0, lng0, dLat, dLng, rows, cols] = num;
  if (!(dLat > 0 && dLng > 0 && Number.isInteger(rows) && Number.isInteger(cols) && rows > 1 && cols > 1)) throw new Error(NOT_GSIGEO);
  const token = (t[7] ?? '').toLowerCase();
  const version = VERSION_TOKENS[token];
  if (!version) throw new Error(`Unsupported geoid model “${t[7] ?? 'no version'}”. Import GSIGEO2011 Ver.2.1 or Ver.2.2.`);
  return { lat0, lng0, dLat: snapDeg(dLat), dLng: snapDeg(dLng), rows, cols, version };
}

/** Parses the whole file; values are whitespace-separated F9.4 fields, a new line per row. */
export function parseGsiGeoid(text: string): GeoidGrid {
  const eol = text.indexOf('\n');
  const header = parseGeoidHeader(eol < 0 ? text : text.slice(0, eol));
  const total = header.rows * header.cols;
  const n = new Float32Array(total);
  let k = 0;
  let i = eol < 0 ? text.length : eol + 1;
  const len = text.length;
  while (i < len) {
    let c = text.charCodeAt(i);
    if (c === 32 || c === 10 || c === 13 || c === 9) {
      i++;
      continue;
    }
    const start = i;
    while (i < len && (c = text.charCodeAt(i)) !== 32 && c !== 10 && c !== 13 && c !== 9) i++;
    const v = Number(text.slice(start, i));
    if (!Number.isFinite(v)) throw new Error(`Bad value “${text.slice(start, i)}” in the geoid file.`);
    if (k === total) throw new Error('The geoid file has more values than its header says.');
    n[k++] = v === NO_DATA ? NaN : v;
  }
  if (k < total) throw new Error(`The geoid file is truncated: ${k} of ${total} values.`);
  return { ...header, n };
}

/** Grid index and fraction along one axis, snapped onto a line within `EL2` as GSI does. */
function axis(u: number): [number, number] {
  let i = Math.floor(u);
  let f = u - i;
  if (f < EL2) f = 0;
  else if (1 - f < EL2) {
    i++;
    f = 0;
  }
  return [i, f];
}

/** Geoid height at a point, metres, by GSI's bilinear rule; throws outside the grid or next to a no-data node. */
export function geoidAt(g: GeoidGrid, lat: number, lng: number): number {
  const [iy, fy] = axis((lat - g.lat0) / g.dLat);
  const [ix, fx] = axis((lng - g.lng0) / g.dLng);
  const jy = fy > 0 ? iy + 1 : iy;
  const jx = fx > 0 ? ix + 1 : ix;
  if (iy < 0 || ix < 0 || jy >= g.rows || jx >= g.cols) throw new Error(`${lat.toFixed(5)}, ${lng.toFixed(5)} is outside the geoid grid.`);
  const at = (r: number, c: number) => g.n[r * g.cols + c];
  const v = (1 - fx) * (1 - fy) * at(iy, ix) + fx * (1 - fy) * at(iy, jx) + (1 - fx) * fy * at(jy, ix) + fx * fy * at(jy, jx);
  // NaN survives a zero weight, so any no-data node the rule reads throws, as GSI's 999 does.
  if (Number.isNaN(v)) throw new Error(`No geoid data at ${lat.toFixed(5)}, ${lng.toFixed(5)}.`);
  return v;
}
