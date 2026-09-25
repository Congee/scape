import { describe, expect, it } from 'vitest';
import { H5_EARLIEST, H5_LATEST } from './hdf5.fixtures';
import { bytesSource, openHdf5 } from './hdf5';

const GRID = 'HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields';
const N = 40;
const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const expected = (i: number) => (i === 0 || i === N * N - 1 ? 65535 : i % 1000);

describe.each([
  ['earliest (superblock v0, symbol tables, v1 B-tree chunks)', H5_EARLIEST],
  ['latest (superblock v3, compact links, fixed-array chunks, fletcher32)', H5_LATEST]
])('openHdf5 %s', (_name, b64) => {
  it('reads file attributes as strings', async () => {
    const f = await openHdf5(bytesSource(bytes(b64)));
    expect(f.attrs.HorizontalTileNumber).toBe('18');
    expect(f.attrs.VerticalTileNumber).toBe('03');
  });

  it('reads a chunked, shuffled, deflated uint16 grid with partial edge chunks', async () => {
    const f = await openHdf5(bytesSource(bytes(b64)));
    const d = await f.dataset(`${GRID}/AllAngle_Composite_Snow_Free`);
    expect(d.shape).toEqual([N, N]);
    expect(d.attrs._FillValue).toBe(65535);
    expect(d.attrs.scale_factor).toBeCloseTo(0.1, 6);
    expect(d.attrs.units).toBe('nWatts/(cm^2 sr)');
    const v = await d.read();
    expect(v).toBeInstanceOf(Uint16Array);
    for (const i of [0, 1, 39, 40, 999, 1000, 1234, N * N - 2, N * N - 1]) expect(v[i]).toBe(expected(i));
  });

  it('reads contiguous and single-chunk float datasets', async () => {
    const f = await openHdf5(bytesSource(bytes(b64)));
    const lat = await (await f.dataset(`${GRID}/lat`)).read();
    expect(lat[0]).toBeCloseTo(60, 5);
    expect(lat[N - 1]).toBeCloseTo(50, 5);
    const r = await (await f.dataset(`${GRID}/Radiance_f32`)).read();
    expect(r).toBeInstanceOf(Float32Array);
    expect(r[1234]).toBeCloseTo(23.4, 4);
  });

  it('reports missing paths', async () => {
    const f = await openHdf5(bytesSource(bytes(b64)));
    expect(await f.has(`${GRID}/NearNadir_Composite_Snow_Free`)).toBe(true);
    expect(await f.has(`${GRID}/Nope`)).toBe(false);
    await expect(f.dataset('HDFEOS/Nope')).rejects.toThrow(/no HDFEOS\/Nope/);
  });
});

it('rejects a non-HDF5 file', async () => {
  await expect(openHdf5(bytesSource(new TextEncoder().encode('<html>login</html>')))).rejects.toThrow(/Not an HDF5/);
});
