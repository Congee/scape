import { describe, expect, it } from 'vitest';
import { tileName, VIIRS_COLS, VIIRS_TILE_PX, type TileId } from '@core/sky/viirs';
import { fillWindow, parseListing, type TileRows } from './viirs';

const P = VIIRS_TILE_PX;
/** Every stored pixel encodes its tile and in-tile position, so a misplaced copy shows. */
const value = (t: TileId, r: number, c: number) => (t.h * 7 + t.v * 3 + r * 5 + c) % 65000 || 1;

const rows =
  (present: string[]): TileRows =>
  async (t, r0, r1) => {
    if (!present.includes(tileName(t))) return null;
    const out = new Uint16Array((r1 - r0) * P);
    for (let r = r0; r < r1; r++) for (let c = 0; c < P; c++) out[(r - r0) * P + c] = value(t, r, c);
    return out;
  };

describe('fillWindow', () => {
  it('stitches four tiles across a corner', async () => {
    const w = { row0: 3 * P - 2, col0: 18 * P - 3, rows: 4, cols: 6 };
    const { win, absent } = await fillWindow(w, rows(['h17v02', 'h18v02', 'h17v03', 'h18v03']));
    expect(absent).toEqual([]);
    expect(win.data[0]).toBe(value({ h: 17, v: 2 }, P - 2, P - 3));
    expect(win.data[5]).toBe(value({ h: 18, v: 2 }, P - 2, 2));
    expect(win.data[3 * 6]).toBe(value({ h: 17, v: 3 }, 1, P - 3));
    expect(win.data[3 * 6 + 5]).toBe(value({ h: 18, v: 3 }, 1, 2));
  });

  it('wraps across the antimeridian', async () => {
    const w = { row0: 0, col0: VIIRS_COLS - 1, rows: 1, cols: 2 };
    const { win } = await fillWindow(w, rows(['h35v00', 'h00v00']));
    expect(win.data[0]).toBe(value({ h: 35, v: 0 }, 0, P - 1));
    expect(win.data[1]).toBe(value({ h: 0, v: 0 }, 0, 0));
  });

  it('leaves absent tiles dark and names them', async () => {
    const w = { row0: 3 * P - 1, col0: 18 * P - 1, rows: 2, cols: 2 };
    const { win, absent } = await fillWindow(w, rows(['h18v03']));
    expect(absent.map(tileName)).toEqual(['h17v02', 'h18v02', 'h17v03']);
    expect([...win.data]).toEqual([0, 0, 0, value({ h: 18, v: 3 }, 0, 0)]);
  });
});

describe('parseListing', () => {
  it('keeps unique VNP46A4 tile names', () => {
    const json = { content: [{ name: 'VNP46A4.A2024001.h18v03.002.2025161220719.h5' }, { name: 'VNP46A4.A2024001.h19v03.002.1.h5' }, { name: 'readme.txt' }, { name: 'VNP46A4.A2024001.h18v03.002.9.h5' }] };
    expect(parseListing(json)).toEqual(['h18v03', 'h19v03']);
  });

  it('rejects a page that is not a listing', () => {
    expect(() => parseListing({ error: 'x' })).toThrow(/no content/);
  });
});
