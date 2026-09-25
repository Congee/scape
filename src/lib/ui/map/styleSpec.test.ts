import { Color, createPropertyExpression, featureFilter, latest, validateStyleMin, type Feature, type LayerSpecification, type StylePropertySpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { BLD_BASE, BLD_HEIGHT, buildingFilter, buildingPaint } from './buildingStyle';
import { ELEVATION_COLOR, ELEVATION_STOPS } from './layerRamps';
import { modelLayers } from './modelOverlay';

const spec = (layerType: string, prop: string) => (latest as unknown as Record<string, Record<string, StylePropertySpecification>>)[`paint_${layerType}`][prop];

const feature = (properties: Record<string, unknown>): Feature => ({ type: 'Polygon', properties });

function evaluate(layerType: string, prop: string, value: unknown, properties: Record<string, unknown> = {}, elevation?: number) {
  const parsed = createPropertyExpression(value, prop, spec(layerType, prop));
  if (parsed.result === 'error') throw new Error(parsed.value.map((e) => e.message).join('; '));
  return parsed.value.evaluate({ zoom: 16, elevation }, feature(properties));
}

const passes = (filter: unknown, properties: Record<string, unknown>) =>
  featureFilter(filter as Parameters<typeof featureFilter>[0], 'filter').filter({ zoom: 16 }, feature(properties));

describe('building height', () => {
  const height = (p: Record<string, unknown>) => evaluate('fill-extrusion', 'fill-extrusion-height', BLD_HEIGHT, p);

  it('takes the measured height first', () => {
    expect(height({ height: 42, num_floors: 3 })).toBe(42);
  });

  it('falls back to 3 m a floor', () => {
    expect(height({ num_floors: 4 })).toBe(12);
  });

  it('is 5 m with neither', () => {
    expect(height({})).toBe(5);
  });

  it('skips a null height', () => {
    expect(height({ height: null, num_floors: 2 })).toBe(6);
    expect(height({ height: null })).toBe(5);
  });

  it('treats a null floor count as present', () => {
    // ['has'] is true for a null key, and null × 3 coerces to 0.
    expect(height({ num_floors: null })).toBe(0);
  });
});

describe('building base', () => {
  const base = (p: Record<string, unknown>) => evaluate('fill-extrusion', 'fill-extrusion-base', BLD_BASE, p);

  it('lifts to min_height, else the ground', () => {
    expect(base({ min_height: 7 })).toBe(7);
    expect(base({})).toBe(0);
    expect(base({ min_height: null })).toBe(0);
  });
});

describe('building filter', () => {
  it('drops a whole building that has parts, but not its parts', () => {
    expect(passes(buildingFilter(true, []), { has_parts: true })).toBe(false);
    expect(passes(buildingFilter(true, []), { has_parts: false })).toBe(true);
    expect(passes(buildingFilter(true, []), {})).toBe(true);
    expect(passes(buildingFilter(false, []), { has_parts: true })).toBe(true);
  });

  it('drops underground rows on both layers', () => {
    for (const whole of [true, false]) {
      expect(passes(buildingFilter(whole, []), { is_underground: true })).toBe(false);
      expect(passes(buildingFilter(whole, []), { is_underground: false })).toBe(true);
      expect(passes(buildingFilter(whole, []), { is_underground: null })).toBe(true);
    }
  });

  it('hides the ids a model stands in for', () => {
    const f = buildingFilter(true, ['a', 'b']);
    expect(passes(f, { id: 'a' })).toBe(false);
    expect(passes(f, { id: 'c' })).toBe(true);
    expect(passes(f, {})).toBe(true);
  });
});

describe('model overlay', () => {
  type Styled = { type: string; filter?: unknown; paint?: Record<string, unknown> };
  const [selectedFill, selectedLine, otherFill] = modelLayers('models') as Styled[];
  const paint = (layer: Styled, prop: string, p: Record<string, unknown>) => evaluate(layer.type, prop, layer.paint?.[prop], p);

  it('splits the selected model from the others', () => {
    expect(passes(selectedFill.filter, { selected: true })).toBe(true);
    expect(passes(selectedFill.filter, { selected: false })).toBe(false);
    expect(passes(otherFill.filter, { selected: false })).toBe(true);
  });

  it('extrudes from base to top and accents the current part', () => {
    const p = { base: 3, top: 15, current: true };
    expect(paint(selectedFill, 'fill-extrusion-base', p)).toBe(3);
    expect(paint(selectedFill, 'fill-extrusion-height', p)).toBe(15);
    expect(paint(selectedFill, 'fill-extrusion-color', p)).not.toEqual(paint(selectedFill, 'fill-extrusion-color', { ...p, current: false }));
    expect(paint(selectedLine, 'line-width', { current: true })).toBe(2.5);
    expect(paint(selectedLine, 'line-width', { current: false })).toBe(1.5);
  });
});

describe('elevation tint', () => {
  it('hits every stop colour exactly', () => {
    for (const [m, hex] of ELEVATION_STOPS) expect(evaluate('color-relief', 'color-relief-color', ELEVATION_COLOR, {}, m)).toEqual(Color.parse(hex));
  });
});

describe('our layers against the style spec', () => {
  it('validate', () => {
    const layers: LayerSpecification[] = [
      { id: 'elev', type: 'color-relief', source: 'dem', paint: { 'color-relief-color': ELEVATION_COLOR } },
      { id: 'bld', type: 'fill-extrusion', source: 'bld', 'source-layer': 'building', minzoom: 14, filter: buildingFilter(true, ['x']), paint: buildingPaint(false) },
      { id: 'bld-part', type: 'fill-extrusion', source: 'bld', 'source-layer': 'building_part', filter: buildingFilter(false, []), paint: buildingPaint(true) },
      ...modelLayers('models')
    ];
    const errors = validateStyleMin({
      version: 8,
      sources: {
        dem: { type: 'raster-dem', tiles: ['dem://{z}/{x}/{y}'] },
        bld: { type: 'vector', tiles: ['bld://{z}/{x}/{y}'] },
        models: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
      },
      layers
    });
    expect(errors.map((e) => e.message)).toEqual([]);
  });
});
