/** Offline building regions: the tiles a box needs, and whether a download takes them by default. */

import type { Bbox } from '@core/geo/bbox';
import { tileCountInBounds } from './pmtiles';

/** The one zoom the viewfinder and the map's extrusions read; MapLibre overzooms past it. */
export const BUILDINGS_ZOOM = 14;
/** Dense cities measured about 300 KB per tile (Manhattan: 84 tiles, 21 MB), so the default stays near 30 MB. */
export const BUILDINGS_DEFAULT_MAX_TILES = 100;

export const buildingTileCount = (b: Bbox): number => tileCountInBounds(b, BUILDINGS_ZOOM, BUILDINGS_ZOOM);

export const buildingsByDefault = (b: Bbox): boolean => buildingTileCount(b) <= BUILDINGS_DEFAULT_MAX_TILES;
