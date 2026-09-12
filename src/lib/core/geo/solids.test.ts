import { describe, expect, it } from 'vitest';
import { MarkerShape } from '@core/plan';
import { faceShade, facesToward, footprint, polarOf, solidOf } from './solids';

const box = (rotationDeg = 0) => solidOf(MarkerShape.Box, { widthM: 10, depthM: 10, heightM: 10, rotationDeg });
const extent = (vs: { e: number; n: number }[]) => ({
  e: Math.max(...vs.map((v) => v.e)) - Math.min(...vs.map((v) => v.e)),
  n: Math.max(...vs.map((v) => v.n)) - Math.min(...vs.map((v) => v.n))
});

describe('solids', () => {
  it('winds a box footprint counter-clockwise with outward side normals', () => {
    const s = box();
    expect(s.vertices).toHaveLength(8);
    expect(s.faces).toHaveLength(5);
    expect(s.faces.slice(0, 4).map((f) => Math.round(f.bearingDeg!))).toEqual([90, 0, 270, 180]);
    expect(s.faces[4].bearingDeg).toBeNull();
    expect(s.faces[4].normal.u).toBeCloseTo(1, 9);
  });

  it('shows only the north side and the top to an eye north of and above the box', () => {
    const s = box();
    const seen = facesToward(s, { e: 0, n: 500, u: 40 });
    expect(seen.map((f) => f.bearingDeg).toSorted()).toEqual([0, null]);
  });

  it('hides the top from an eye below it', () => {
    const seen = facesToward(box(), { e: 0, n: 500, u: 2 });
    expect(seen.map((f) => f.bearingDeg)).toEqual([0]);
  });

  it('swaps width and depth when the footprint turns 90°', () => {
    const flat = footprint(MarkerShape.Box, { widthM: 30, depthM: 10, heightM: 5, rotationDeg: 0 });
    expect(extent(flat).e).toBeCloseTo(30, 9);
    expect(extent(flat).n).toBeCloseTo(10, 9);
    const turned = footprint(MarkerShape.Box, { widthM: 30, depthM: 10, heightM: 5, rotationDeg: 90 });
    expect(extent(turned).e).toBeCloseTo(10, 9);
    expect(extent(turned).n).toBeCloseTo(30, 9);
  });

  it('turns the footprint clockwise from north', () => {
    const [first] = footprint(MarkerShape.Box, { widthM: 20, depthM: 20, heightM: 1, rotationDeg: 90 });
    expect(polarOf(first).bearingDeg).toBeCloseTo(225, 6);
  });

  it('builds a 16-sided cylinder and a four-sided spire', () => {
    const cyl = solidOf(MarkerShape.Cylinder, { widthM: 8, depthM: 0, heightM: 20, rotationDeg: 0 });
    expect(cyl.vertices).toHaveLength(32);
    expect(cyl.faces).toHaveLength(17);
    expect(polarOf(cyl.vertices[0]).distM).toBeCloseTo(4, 9);
    const spire = solidOf(MarkerShape.Spire, { widthM: 6, depthM: 40, heightM: 30, rotationDeg: 0 });
    expect(spire.vertices).toHaveLength(5);
    expect(spire.faces).toHaveLength(4);
    expect(spire.faces.every((f) => f.normal.u > 0)).toBe(true);
    expect(extent(spire.vertices).n).toBeCloseTo(6, 9);
  });

  it('has no solid for a bar or a zero-sized marker', () => {
    expect(solidOf(MarkerShape.Bar, { widthM: 10, depthM: 10, heightM: 10, rotationDeg: 0 }).faces).toHaveLength(0);
    expect(solidOf(MarkerShape.Box, { widthM: 0, depthM: 10, heightM: 10, rotationDeg: 0 }).faces).toHaveLength(0);
  });

  it('lights the face that turns toward the light', () => {
    const s = box();
    const north = s.faces.find((f) => f.bearingDeg === 0)!;
    const south = s.faces.find((f) => f.bearingDeg === 180)!;
    expect(faceShade(north, 0)).toBeGreaterThan(faceShade(south, 0));
    expect(faceShade(s.faces[4], 0)).toBeGreaterThan(faceShade(north, 0));
  });
});
