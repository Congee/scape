import { describe, expect, it } from 'vitest';
import { GeoidVersion, geoidAt, parseGeoidHeader, parseGsiGeoid } from './geoid';
import { gsiGeoidText, type GeoidFixture } from './geoidFixture';

// A 1′ × 1.5′ grid like GSI's, 4 rows × 30 columns so each row wraps past 28 values.
const G: GeoidFixture = { lat0: 35, lng0: 139, dLat: 1 / 60, dLng: 1.5 / 60, rows: 4, cols: 30 };
const node = (r: number, c: number) => 30 + r + c / 100;
const lat = (r: number) => G.lat0 + r / 60;
const lng = (c: number) => G.lng0 + (c * 1.5) / 60;

describe('parseGeoidHeader', () => {
  it("reads GSI's header and snaps its rounded spacing to 1′ × 1.5′", () => {
    const h = parseGeoidHeader('  20.00000 120.00000 0.016667 0.025000 1801 1201 1 ver2.2          \r');
    expect(h).toMatchObject({ lat0: 20, lng0: 120, rows: 1801, cols: 1201, version: GeoidVersion.V22 });
    expect(h.dLat).toBe(1 / 60);
    expect(h.dLng).toBe(1.5 / 60);
    expect(parseGeoidHeader('  20.00000 120.00000 0.016667 0.025000 1801 1201 1 ver2.1').version).toBe(GeoidVersion.V21);
  });

  it('rejects other models with a message naming what to import', () => {
    expect(() => parseGeoidHeader('  20.00000 120.00000 0.016667 0.025000 1801 1201 1 ver1.0')).toThrow(/Unsupported geoid model “ver1\.0”.*Ver\.2\.1 or Ver\.2\.2/);
    expect(() => parseGeoidHeader('  20.00000 120.00000 0.016667 0.025000 1801 1201 1')).toThrow(/no version/);
    expect(() => parseGeoidHeader('begin_of_head ================================================')).toThrow(/ISG file \(e\.g\. JPGEO2024\)/);
    expect(() => parseGeoidHeader('ply')).toThrow(/Not a GSIGEO2011/);
  });
});

describe('parseGsiGeoid', () => {
  it('stores rows from the south, each west to east, across wrapped lines', () => {
    const g = parseGsiGeoid(gsiGeoidText(G, node));
    expect(g.n.length).toBe(120);
    expect(g.n[0]).toBeCloseTo(node(0, 0), 4);
    expect(g.n[29]).toBeCloseTo(node(0, 29), 4);
    expect(g.n[30]).toBeCloseTo(node(1, 0), 4);
    expect(geoidAt(g, lat(3), lng(28))).toBeCloseTo(node(3, 28), 4);
  });

  it('reads 999 as no data', () => {
    const g = parseGsiGeoid(gsiGeoidText(G, (r, c) => (r === 1 && c === 1 ? NaN : node(r, c))));
    expect(g.n[31]).toBeNaN();
  });

  it('accepts LF line ends and rejects a truncated or overlong file', () => {
    const text = gsiGeoidText(G, node);
    expect(parseGsiGeoid(text.replaceAll('\r\n', '\n')).n[119]).toBeCloseTo(node(3, 29), 4);
    expect(() => parseGsiGeoid(text.slice(0, -300))).toThrow(/truncated/);
    expect(() => parseGsiGeoid(`${text} 1.0000`)).toThrow(/more values/);
  });
});

describe('geoidAt', () => {
  const cell = (v: [number, number, number, number]) => parseGsiGeoid(gsiGeoidText({ ...G, rows: 2, cols: 2 }, (r, c) => v[r * 2 + c]));

  it("matches GSI's bilinear by hand", () => {
    // SW 30, SE 32, NW 34, NE 40; a quarter east, half north.
    const g = cell([30, 32, 34, 40]);
    // 0.375·30 + 0.125·32 + 0.375·34 + 0.125·40 = 11.25 + 4 + 12.75 + 5
    expect(geoidAt(g, lat(0.5), lng(0.25))).toBeCloseTo(33, 9);
    expect(geoidAt(g, lat(1), lng(1))).toBe(40);
    expect(geoidAt(g, lat(0), lng(0.5))).toBeCloseTo(31, 9);
  });

  it('throws next to a no-data node but not on a line that avoids it', () => {
    const g = cell([30, 32, NaN, 40]);
    expect(() => geoidAt(g, lat(0.5), lng(0.5))).toThrow(/No geoid data/);
    expect(geoidAt(g, lat(0), lng(0.5))).toBeCloseTo(31, 9);
    expect(geoidAt(g, lat(0.5), lng(1))).toBeCloseTo(36, 9);
    // Within GSI's 1e-5 cell of the south line counts as on it.
    expect(geoidAt(g, lat(4e-6), lng(0.5))).toBeCloseTo(31, 9);
    expect(() => geoidAt(g, lat(1), lng(0))).toThrow(/No geoid data/);
  });

  it('throws outside the grid', () => {
    const g = cell([30, 32, 34, 40]);
    expect(() => geoidAt(g, lat(-0.01), lng(0.5))).toThrow(/outside/);
    expect(() => geoidAt(g, lat(0.5), lng(1.01))).toThrow(/outside/);
    expect(() => geoidAt(g, 51.9, 4.48)).toThrow(/outside/);
  });
});
