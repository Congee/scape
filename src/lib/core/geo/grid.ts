import { lngLatToTilePixel, metersPerPixel, tilePixelToLngLat } from '@core/terrain/tiles';
import type { LngLat } from './geodesy';

/** Square raster of n × n cells in normalized Web Mercator (0..1), row 0 at the north edge. */
export interface HeatGrid {
  n: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Grid centred on a point, `halfSizeM` ground metres to each edge; conformal, so cells are square. */
export function gridAround(centre: LngLat, halfSizeM: number, n: number): HeatGrid {
  const c = lngLatToTilePixel(centre.lng, centre.lat, 0, 1);
  const half = halfSizeM / metersPerPixel(centre.lat, 0, 1);
  return { n, x0: c.px - half, x1: c.px + half, y0: c.py - half, y1: c.py + half };
}

export function gridCentre(g: HeatGrid): LngLat {
  return tilePixelToLngLat(0, 0, 0, (g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2, 1);
}

export function cellCentre(g: HeatGrid, row: number, col: number): LngLat {
  return tilePixelToLngLat(0, 0, 0, g.x0 + ((col + 0.5) * (g.x1 - g.x0)) / g.n, g.y0 + ((row + 0.5) * (g.y1 - g.y0)) / g.n, 1);
}

/** Cell containing a point, or null outside the grid. */
export function cellOf(g: HeatGrid, p: LngLat): { row: number; col: number } | null {
  const t = lngLatToTilePixel(p.lng, p.lat, 0, 1);
  const col = Math.floor(((t.px - g.x0) / (g.x1 - g.x0)) * g.n);
  const row = Math.floor(((t.py - g.y0) / (g.y1 - g.y0)) * g.n);
  if (col < 0 || row < 0 || col >= g.n || row >= g.n) return null;
  return { row, col };
}

/** Ground size of one cell at the grid centre, metres. */
export function cellSizeM(g: HeatGrid): number {
  return ((g.x1 - g.x0) / g.n) * metersPerPixel(gridCentre(g).lat, 0, 1);
}

const corner = (x: number, y: number): [number, number] => {
  const p = tilePixelToLngLat(0, 0, 0, x, y, 1);
  return [p.lng, p.lat];
};

/** Corner positions for an image source: top-left, top-right, bottom-right, bottom-left. */
export function gridCorners(g: HeatGrid): [[number, number], [number, number], [number, number], [number, number]] {
  return [corner(g.x0, g.y0), corner(g.x1, g.y0), corner(g.x1, g.y1), corner(g.x0, g.y1)];
}

/** Normalized Mercator extent of the grid grown by `marginM` ground metres. */
export function gridBounds(g: HeatGrid, marginM = 0): { x0: number; x1: number; y0: number; y1: number } {
  const m = marginM / metersPerPixel(gridCentre(g).lat, 0, 1);
  return { x0: g.x0 - m, x1: g.x1 + m, y0: g.y0 - m, y1: g.y1 + m };
}
