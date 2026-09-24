/** Synthetic GSIGEO2011-format files for tests and smoke runs; never real geoid data. */

export interface GeoidFixture {
  lat0: number;
  lng0: number;
  /** Header spacing, written rounded as GSI's F9.6 does. */
  dLat: number;
  dLng: number;
  rows: number;
  cols: number;
  version?: string;
}

const PER_LINE = 28;
const LINE = 252;

const f = (v: number, w: number, d: number) => v.toFixed(d).padStart(w);

/** GSI's layout: padded CRLF lines, a header, then rows from the south, 28 F9.4 values a line, each row on new lines; NaN writes 999. */
export function gsiGeoidText(g: GeoidFixture, n: (row: number, col: number) => number): string {
  const lines = [`${f(g.lat0, 10, 5)}${f(g.lng0, 10, 5)}${f(g.dLat, 9, 6)}${f(g.dLng, 9, 6)}${f(g.rows, 5, 0)}${f(g.cols, 5, 0)} 1 ${g.version ?? 'ver2.2'}`];
  for (let r = 0; r < g.rows; r++) {
    let line = '';
    for (let c = 0; c < g.cols; c++) {
      const v = n(r, c);
      line += f(Number.isNaN(v) ? 999 : v, 9, 4);
      if ((c + 1) % PER_LINE === 0 || c === g.cols - 1) {
        lines.push(line);
        line = '';
      }
    }
  }
  return lines.map((l) => `${l.padEnd(LINE)}\r\n`).join('');
}
