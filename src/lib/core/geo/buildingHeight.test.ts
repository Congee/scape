import { describe, expect, it } from 'vitest';
import { buildingLayerIds, heightFromFeatures } from './buildingHeight';

describe('building layer ids', () => {
  it('takes every layer drawn from the building source-layer', () => {
    const layers = [
      { id: 'water', 'source-layer': 'water' },
      { id: 'building', 'source-layer': 'building' },
      { id: 'building-3d', 'source-layer': 'building' },
      { id: 'building-label', 'source-layer': 'poi' },
      { id: 'background' }
    ];
    expect(buildingLayerIds(layers)).toEqual(['building', 'building-3d']);
  });

  it('has none for a raster or missing style', () => {
    expect(buildingLayerIds([{ id: 'raster' }])).toEqual([]);
    expect(buildingLayerIds(undefined)).toEqual([]);
  });
});

describe('building height', () => {
  it('takes the tallest hit', () => {
    const hits = [{ properties: { render_height: 12, render_min_height: 0 } }, { properties: { render_height: 387 } }, { properties: { render_height: 5 } }];
    expect(heightFromFeatures(hits)).toBe(387);
  });

  it('falls back to height and accepts numeric strings', () => {
    expect(heightFromFeatures([{ properties: { height: '42' } }])).toBe(42);
    expect(heightFromFeatures([{ properties: { render_height: '30', height: 10 } }])).toBe(30);
  });

  it('is null without a usable height', () => {
    expect(heightFromFeatures([])).toBeNull();
    expect(heightFromFeatures([{ properties: null }, { properties: {} }])).toBeNull();
    expect(heightFromFeatures([{ properties: { render_height: 0 } }, { properties: { render_height: 'n/a' } }])).toBeNull();
  });
});
