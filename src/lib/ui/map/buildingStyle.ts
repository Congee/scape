import type { ExpressionSpecification, FillExtrusionLayerSpecification } from 'maplibre-gl';

export const BLD_HEIGHT: ExpressionSpecification = ['coalesce', ['get', 'height'], ['case', ['has', 'num_floors'], ['*', ['get', 'num_floors'], 3], 5]];
export const BLD_BASE: ExpressionSpecification = ['coalesce', ['get', 'min_height'], 0];
const NOT_UNDERGROUND: ExpressionSpecification = ['!=', ['get', 'is_underground'], true];

export function buildingPaint(dark: boolean): FillExtrusionLayerSpecification['paint'] {
  return {
    'fill-extrusion-color': dark ? '#5a6472' : '#c9ced6',
    'fill-extrusion-height': BLD_HEIGHT,
    'fill-extrusion-base': BLD_BASE,
    'fill-extrusion-opacity': 0.9,
    'fill-extrusion-vertical-gradient': true
  };
}

/** Overture replaces a building that has parts with those parts; drawing both double-draws it. A model hides what it stands in for. */
export function buildingFilter(whole: boolean, hiddenIds: readonly string[]): ExpressionSpecification {
  const own: ExpressionSpecification[] = whole ? [['!=', ['get', 'has_parts'], true], NOT_UNDERGROUND] : [NOT_UNDERGROUND];
  return hiddenIds.length ? ['all', ...own, ['!', ['in', ['get', 'id'], ['literal', [...hiddenIds]]]]] : ['all', ...own];
}
