import { describe, expect, it } from 'vitest';
import { drawnModel } from '@core/model/draw';
import { coverProbe, draftFeatures, modelFeatures, modelLayers, MODELS_FILL_LAYER, MODELS_LINE_LAYER, OTHER_MODELS_FILL_LAYER } from './modelOverlay';

const pts = [
  { lng: 0, lat: 0 },
  { lng: 0.0002, lat: 0 },
  { lng: 0.0002, lat: 0.0002 }
];

describe('modelFeatures', () => {
  const m = drawnModel(pts, 'm', 12, 0)!;
  m.anchor.altM = 3;
  const partId = m.parts![0].id;

  it('extrudes each part from its lift to its apex', () => {
    const f = modelFeatures([m], null, null).features;
    expect(f).toHaveLength(1);
    expect(f[0].properties).toMatchObject({ base: 3, top: 15, selected: false, current: false });
    expect(f[0].geometry.coordinates[0]).toHaveLength(4);
  });

  it('marks the selected part', () => {
    expect(modelFeatures([m], m.id, partId).features[0].properties).toMatchObject({ selected: true, current: true });
    expect(modelFeatures([m], null, partId).features[0].properties.current).toBe(false);
  });

  it('leaves hidden models off the map', () => {
    expect(modelFeatures([{ ...m, visible: false }], null, null).features).toHaveLength(0);
  });
});

describe('draftFeatures', () => {
  it('draws an open line until the ring can close', () => {
    expect(draftFeatures([[0, 0], [1, 0]]).features.map((f) => f.geometry.type)).toEqual(['LineString']);
    const closed = draftFeatures([[0, 0], [1, 0], [1, 1]]).features;
    expect(closed.map((f) => f.geometry.type)).toEqual(['LineString', 'Polygon']);
  });
  it('is empty when not drawing', () => {
    expect(draftFeatures(null).features).toHaveLength(0);
  });
});

describe('modelLayers', () => {
  it('draws the selected outline before the other models, so those in front hide it', () => {
    const ids = modelLayers('models').map((l) => l.id);
    expect(ids).toEqual([MODELS_FILL_LAYER, MODELS_LINE_LAYER, OTHER_MODELS_FILL_LAYER, 'models-line-others']);
  });

  it('splits every feature into exactly one fill and one line by selection', () => {
    const filters = modelLayers('models').map((l) => ('filter' in l ? l.filter : null));
    expect(filters).toEqual([true, true, false, false].map((v) => ['==', ['get', 'selected'], v]));
  });
});

describe('coverProbe', () => {
  it('steps toward the centre', () => {
    expect(coverProbe({ x: 0, y: 0 }, { x: 30, y: 40 }, 5)).toEqual({ x: 3, y: 4 });
  });

  it('stops halfway on a tiny footprint and stays put on its centre', () => {
    expect(coverProbe({ x: 0, y: 0 }, { x: 4, y: 0 }, 5)).toEqual({ x: 2, y: 0 });
    expect(coverProbe({ x: 1, y: 1 }, { x: 1, y: 1 }, 5)).toEqual({ x: 1, y: 1 });
  });
});
