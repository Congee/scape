// oxlint-disable no-underscore-dangle -- _FillValue is HDF5's attribute name
/** One VNP46A4 .h5 tile decoded to stored counts. */

import { openHdf5, type H5Source, type H5Value } from '@core/io/hdf5';
import { parseViirsName, toCounts, VIIRS_TILE_PX, type TileId } from './viirs';

const FIELDS = 'HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields/';
/** Snow-free all-angle composite first; near-nadir as in early collections. */
export const VIIRS_FIELDS = [`${FIELDS}AllAngle_Composite_Snow_Free`, `${FIELDS}NearNadir_Composite_Snow_Free`] as const;

export interface ViirsTile {
  year: number;
  tile: TileId;
  counts: Uint16Array;
}

const num = (v: H5Value | undefined): number | null => {
  const x = Array.isArray(v) ? v[0] : v;
  const n = typeof x === 'string' ? Number(x.trim()) : x;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** Year from the LAADS name, tile from the name or the file's tile attributes; throws on anything else. */
export async function decodeViirsTile(src: H5Source, fileName: string, px = VIIRS_TILE_PX): Promise<ViirsTile> {
  const named = parseViirsName(fileName);
  if (!named) throw new Error(`${fileName} is not a VNP46A4 file name (VNP46A4.A<year>001.hXXvYY…h5).`);
  const f = await openHdf5(src);
  const h = num(f.attrs.HorizontalTileNumber);
  const v = num(f.attrs.VerticalTileNumber);
  if (h !== null && v !== null && (h !== named.tile.h || v !== named.tile.v)) throw new Error(`${fileName} holds tile h${h}v${v}, not the one its name says.`);
  const found = await Promise.all(VIIRS_FIELDS.map((p) => f.has(p)));
  const path = VIIRS_FIELDS.find((_, i) => found[i]);
  if (!path) throw new Error(`${fileName} has no snow-free composite radiance.`);
  const ds = await f.dataset(path);
  if (ds.shape.length !== 2 || ds.shape[0] !== px || ds.shape[1] !== px) throw new Error(`${fileName}: expected a ${px}×${px} grid, got ${ds.shape.join('×')}.`);
  const counts = toCounts(await ds.read(), num(ds.attrs.scale_factor) ?? 1, num(ds.attrs.add_offset) ?? num(ds.attrs.offset) ?? 0, num(ds.attrs._FillValue));
  return { year: named.year, tile: named.tile, counts };
}
