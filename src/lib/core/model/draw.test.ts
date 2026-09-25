import { describe, expect, it } from 'vitest';
import { distanceM, bearingDeg } from '@core/geo/geodesy';
import { lngLatToLocal, localToLngLat } from '@core/model';
import { RoofShape } from '@workers/buildings.protocol';
import { partsMesh } from './mesh';
import { applyNudge, apexOf, drawnModel, nearestWithin, NudgeKind, nudgeForKey, ringEdges, silhouetteEdges, snapRightAngle, visibleRuns, withEdgeBearing, withEdgeLength } from './draw';

const flat = { headingDeg: 0, scale: 1 };

describe('snapRightAngle', () => {
  it('squares the corner at the last vertex', () => {
    expect(snapRightAngle([[0, 0], [10, 0]], [11, 7])).toEqual([10, 7]);
  });
  it('keeps going straight when that is nearer', () => {
    const [e, n] = snapRightAngle([[0, 0], [10, 0]], [16, 1]);
    expect(e).toBeCloseTo(16, 9);
    expect(n).toBeCloseTo(0, 9);
  });
  it('leaves the first two taps alone', () => {
    expect(snapRightAngle([[0, 0]], [3, 4])).toEqual([3, 4]);
  });
});

describe('nearestWithin', () => {
  it('takes the nearest point inside the radius', () => {
    expect(nearestWithin([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 1 }], { x: 6, y: 0 }, 12)).toBe(2);
  });
  it('finds nothing past the radius', () => {
    expect(nearestWithin([{ x: 20, y: 0 }], { x: 0, y: 0 }, 12)).toBe(-1);
  });
});

describe('edges', () => {
  const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  it('reads lengths and true bearings through the heading', () => {
    const e = ringEdges(square, { headingDeg: 30, scale: 2 });
    expect(e[0].lengthM).toBeCloseTo(20, 9);
    expect(e[0].bearingDeg).toBeCloseTo(120, 9);
    expect(e[3].bearingDeg).toBeCloseTo(210, 9);
  });
  it('stretches an edge by moving its far end', () => {
    const r = withEdgeLength(square, 0, 15, flat);
    expect(r[1][0]).toBeCloseTo(15, 9);
    expect(r[1][1]).toBeCloseTo(0, 9);
    expect(r[0]).toEqual([0, 0]);
  });
  it('turns an edge about its start', () => {
    const anchor = { headingDeg: 10, scale: 1 };
    const r = withEdgeBearing(square, 1, 10, anchor);
    expect(ringEdges(r, anchor)[1].bearingDeg).toBeCloseTo(10, 9);
    expect(ringEdges(r, anchor)[1].lengthM).toBeCloseTo(10, 9);
    expect(r[2][0]).toBeCloseTo(10, 9);
    expect(r[2][1]).toBeCloseTo(10, 9);
  });
  it('wraps the last edge back to the first vertex', () => {
    const r = withEdgeLength(square, 3, 5, flat);
    expect(r[0][1]).toBeCloseTo(5, 9);
  });
});

describe('drawnModel', () => {
  const at = { lng: -74.0, lat: 40.7 };
  const pts = [at, localToLngLat({ ...at, altRef: 'Ground', altM: 0, headingDeg: 0, scale: 1 }, 20, 0), localToLngLat({ ...at, altRef: 'Ground', altM: 0, headingDeg: 0, scale: 1 }, 20, 10)];
  it('makes one flat part around the bounding-box centre', () => {
    const m = drawnModel(pts, 'Drawn 1', 12, 0)!;
    expect(m.parts).toHaveLength(1);
    expect(m.parts![0].heightM).toBe(12);
    const [e, n] = lngLatToLocal(m.anchor, at);
    expect(e).toBeCloseTo(-10, 3);
    expect(n).toBeCloseTo(-5, 3);
    expect(m.footprint).toHaveLength(3);
  });
  it('needs three taps', () => {
    expect(drawnModel(pts.slice(0, 2), 'x', 10)).toBeNull();
  });
});

describe('nudges', () => {
  const m = drawnModel(
    [
      { lng: 0, lat: 0 },
      { lng: 0.0002, lat: 0 },
      { lng: 0.0002, lat: 0.0002 }
    ],
    'n',
    10,
    0
  )!;
  it('maps the keys', () => {
    expect(nudgeForKey('ArrowLeft', false, false)).toEqual({ kind: NudgeKind.East, by: -0.1 });
    expect(nudgeForKey('ArrowUp', true, false)).toEqual({ kind: NudgeKind.North, by: 1 });
    expect(nudgeForKey('ArrowRight', false, true)).toEqual({ kind: NudgeKind.Heading, by: 0.05 });
    expect(nudgeForKey('ArrowDown', true, true)).toEqual({ kind: NudgeKind.Lift, by: -1 });
    expect(nudgeForKey('a', false, false)).toBeNull();
  });
  it('moves the anchor over the ground', () => {
    const p = applyNudge(m, { kind: NudgeKind.East, by: 1 }, null).anchor!;
    expect(distanceM(m.anchor, p)).toBeCloseTo(1, 6);
    expect(bearingDeg(m.anchor, p)).toBeCloseTo(90, 3);
  });
  it('turns, lifts and raises', () => {
    expect(applyNudge(m, { kind: NudgeKind.Heading, by: -0.05 }, null).anchor!.headingDeg).toBeCloseTo(359.95, 9);
    expect(applyNudge(m, { kind: NudgeKind.Lift, by: 0.1 }, null).anchor!.altM).toBeCloseTo(0.1, 9);
    expect(applyNudge(m, { kind: NudgeKind.Height, by: 1 }, null).parts![0].heightM).toBe(11);
  });
});

describe('apexOf', () => {
  it('stands over the top vertex', () => {
    const m = drawnModel([{ lng: 0, lat: 0 }, { lng: 0.0002, lat: 0 }, { lng: 0.0002, lat: 0.0002 }, { lng: 0, lat: 0.0002 }], 'a', 30, 0)!;
    m.anchor.altM = 2;
    const a = apexOf(m, partsMesh(m.parts!).pos)!;
    expect(a.aboveGroundM).toBeCloseTo(32, 6);
    expect(distanceM(a.at, m.anchor)).toBeLessThan(0.01);
  });
});

describe('silhouetteEdges', () => {
  // A 10 m cube 50 m north of the eye, straddling eye level.
  const ring: [number, number][] = [[-5, 45], [5, 45], [5, 55], [-5, 55]];
  const mesh = partsMesh([{ id: 'c', ring, baseM: -5, heightM: 5, roof: RoofShape.Flat, roofHeightM: 0, roofDirDeg: NaN, roofAcross: 0 }]);
  it('outlines the near face only', () => {
    const seg = silhouetteEdges(mesh.pos, mesh.idx);
    // Only the south wall faces an eye straight in front and level: its four edges.
    expect(seg.length / 6).toBe(4);
    for (let i = 1; i < seg.length; i += 3) expect(seg[i]).toBeCloseTo(45, 6);
  });
});

describe('visibleRuns', () => {
  const seg = Float32Array.of(0, 10, 0, 10, 10, 0);
  it('keeps a clear segment whole', () => {
    expect([...visibleRuns(seg, () => 4, () => false)]).toEqual([0, 10, 0, 10, 10, 0]);
  });

  it('drops the pieces behind an occluder and splits around it', () => {
    const runs = visibleRuns(seg, () => 10, (e) => e > 3 && e < 6);
    expect([...runs]).toEqual([0, 10, 0, 3, 10, 0, 6, 10, 0, 10, 10, 0]);
  });

  it('drops a segment hidden throughout', () => {
    expect(visibleRuns(seg, () => 8, () => true).length).toBe(0);
  });

  it('samples piece midpoints, never the shared end points', () => {
    const at: number[] = [];
    visibleRuns(seg, () => 2, (e) => (at.push(e), false));
    expect(at).toEqual([2.5, 7.5]);
  });
});
