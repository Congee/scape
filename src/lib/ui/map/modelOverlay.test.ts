import { describe, expect, it } from 'vitest';
import { drawnModel } from '@core/model/draw';
import { draftFeatures, modelFeatures } from './modelOverlay';

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
