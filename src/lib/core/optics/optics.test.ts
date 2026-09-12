import { describe, expect, it } from 'vitest';
import { depthOfField, hyperfocalM, panoramaCoverageDeg, panoramaShots } from './dof';
import { circleOfConfusionMm, cropFactor, focalForFovMm, fovDeg, frameFov, Orientation, SENSORS } from './fov';
import { cameraBasis, discRadiusMm, inFrame, project, unproject, type Camera } from './projection';

const ff = SENSORS[0];
const mft = SENSORS.find((s) => s.id === 'mft')!;

describe('field of view', () => {
  it('matches the textbook full-frame angles', () => {
    expect(fovDeg(36, 50)).toBeCloseTo(39.6, 1);
    expect(fovDeg(24, 50)).toBeCloseTo(27.0, 1);
    expect(fovDeg(36, 24)).toBeCloseTo(73.7, 1);
    expect(fovDeg(36, 200)).toBeCloseTo(10.3, 1);
  });

  it('swaps sides in portrait', () => {
    const l = frameFov(ff, 35, Orientation.Landscape);
    const p = frameFov(ff, 35, Orientation.Portrait);
    expect(p.hDeg).toBeCloseTo(l.vDeg, 9);
    expect(p.vDeg).toBeCloseTo(l.hDeg, 9);
    expect(p.dDeg).toBeCloseTo(l.dDeg, 9);
  });

  it('inverts', () => {
    expect(focalForFovMm(36, fovDeg(36, 85))).toBeCloseTo(85, 9);
  });

  it('scales crop factor and circle of confusion together', () => {
    expect(cropFactor(ff)).toBeCloseTo(1, 9);
    expect(cropFactor(mft)).toBeCloseTo(2.0, 1);
    expect(circleOfConfusionMm(mft)).toBeCloseTo(0.015, 3);
  });
});

describe('depth of field', () => {
  it('reproduces a standard 50 mm f/8 example', () => {
    expect(hyperfocalM(50, 8, 0.03)).toBeCloseTo(10.47, 2);
    const d = depthOfField(50, 8, 0.03, 5);
    expect(d.nearM).toBeCloseTo(3.39, 2);
    expect(d.farM).toBeCloseTo(9.53, 2);
  });

  it('reaches infinity at and beyond the hyperfocal distance', () => {
    expect(depthOfField(50, 8, 0.03, 11).farM).toBe(Infinity);
    expect(depthOfField(50, 8, 0.03, 11).nearM).toBeCloseTo(5.36, 2);
  });
});

describe('panorama', () => {
  it('counts frames with overlap', () => {
    expect(panoramaShots(39.6, 39.6).shots).toBe(1);
    const p = panoramaShots(120, 39.6, 0.3);
    expect(p.shots).toBe(4);
    expect(p.stepDeg).toBeCloseTo((120 - 39.6) / 3, 6);
    expect(panoramaCoverageDeg(4, 39.6, 0.3)).toBeCloseTo(39.6 + 3 * 39.6 * 0.7, 6);
  });
});

describe('projection', () => {
  const cam: Camera = { azimuthDeg: 90, elevationDeg: 0, focalMm: 50, frameWmm: 36, frameHmm: 24 };
  const basis = cameraBasis(cam);

  it('puts the axis at the centre and edges at half the field of view', () => {
    const centre = project(cam, basis, 90, 0)!;
    expect(centre.x).toBeCloseTo(0, 9);
    expect(centre.y).toBeCloseTo(0, 9);
    const half = fovDeg(36, 50) / 2;
    const edge = project(cam, basis, 90 + half, 0)!;
    expect(edge.x).toBeCloseTo(18, 6);
    expect(edge.y).toBeCloseTo(0, 6);
    expect(inFrame(cam, edge)).toBe(true);
    expect(inFrame(cam, project(cam, basis, 90 + half + 1, 0)!)).toBe(false);
    expect(project(cam, basis, 270, 0)).toBeNull();
  });

  it('is level: up on the sensor is up in the sky', () => {
    const p = project(cam, basis, 90, 10)!;
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(50 * Math.tan((10 * Math.PI) / 180), 9);
  });

  it('round-trips through unproject, including a tilted camera', () => {
    const tilted: Camera = { ...cam, azimuthDeg: 215, elevationDeg: 12 };
    const b = cameraBasis(tilted);
    for (const [az, alt] of [
      [200, 5],
      [230, 20],
      [215, 12],
      [240, -3]
    ]) {
      const p = project(tilted, b, az, alt)!;
      const back = unproject(tilted, b, p.x, p.y);
      expect(back.azimuthDeg).toBeCloseTo(az, 6);
      expect(back.altitudeDeg).toBeCloseTo(alt, 6);
    }
  });

  it('sizes the sun disc', () => {
    expect(discRadiusMm(cam, 0.2667)).toBeCloseTo(0.2327, 3);
  });
});
