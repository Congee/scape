import { SLOPE_BANDS_DEG } from '@core/terrain/slope';
import { TERRAIN_SOURCE_ID, TerrainSourceId } from '@data/terrainTiles';

/** Fixed hypsometric stops, metres; spaced tighter low down where most land is. */
const LAND_STOPS: [number, string][] = [
  [0, '#4a9950'],
  [100, '#7cb65c'],
  [300, '#b7cf73'],
  [600, '#e6dc8a'],
  [1000, '#e4b86b'],
  [1500, '#cc8a4f'],
  [2000, '#a8664a'],
  [2500, '#8c5a4f'],
  [3000, '#9a8a86'],
  [4000, '#d4d0cf'],
  [5000, '#ffffff']
];

/** Mapterhorn has no bathymetry, so below zero is polder or depression, not sea. */
const BELOW_ZERO_STOPS: [number, string][] =
  TERRAIN_SOURCE_ID === TerrainSourceId.Mapterhorn
    ? [[-500, '#2f7a3f']]
    : [
        [-8000, '#0b2a5b'],
        [-4000, '#1d4f8f'],
        [-1000, '#3f7fbf'],
        [-100, '#7fb2df'],
        [-1, '#b9d8f0']
      ];

export const ELEVATION_STOPS: readonly [number, string][] = [...BELOW_ZERO_STOPS, ...LAND_STOPS];

/** Legend ticks, metres. */
export const ELEVATION_TICKS = TERRAIN_SOURCE_ID === TerrainSourceId.Mapterhorn ? [0, 1000, 2000, 3000, 5000] : [-8000, -4000, 0, 2000, 5000];

/** One colour per slope band; the gentlest is left clear. */
export const SLOPE_COLORS = ['transparent', '#b8e186', '#ffe34d', '#ff8a00', '#d7263d'] as const;

export const SLOPE_LEGEND = SLOPE_COLORS.map((color, i) => ({
  color,
  label: i === 0 ? `<${SLOPE_BANDS_DEG[0]}°` : i === SLOPE_BANDS_DEG.length ? `${SLOPE_BANDS_DEG[i - 1]}°+` : `${SLOPE_BANDS_DEG[i - 1]}–${SLOPE_BANDS_DEG[i]}°`
}));

/** Aspect hue wheel: north red, turning clockwise through yellow (east) and cyan (south). */
export const ASPECT_SATURATION = 0.8;
export const ASPECT_VALUE = 0.95;

export const NIGHT_COLOR = '#0a1030';
export const RISE_LINE_COLOR = '#ffb347';

/** Per-cap alpha so the four nested caps compound to `opacity` in full night. */
export const nightCapAlpha = (opacity: number) => 1 - Math.pow(1 - Math.min(opacity, 0.999), 1 / 4);

/** Parses `#rrggbb` to 0…1 RGB. */
export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
