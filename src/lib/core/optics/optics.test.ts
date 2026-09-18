import { describe, expect, it } from 'vitest';
import { depthOfField, hyperfocalM, panoramaCoverageDeg, panoramaShots } from './dof';
import {
  aperturesFor,
  circleOfConfusionMm,
  clampBaseFocalMm,
  clampFocalMm,
  CocRule,
  cocMm,
  cropFactor,
  effectiveOptics,
  equivalentFocalMm,
  focalForFovMm,
  fovDeg,
  frameAzimuthHalfDeg,
  frameElevationSpanDeg,
  frameFov,
  maxApertureAt,
  Orientation,
  SENSORS,
  tcFactor,
  Teleconverter,
  type LensSpec
} from './fov';
import { cameraBasis, discRadiusMm, inFrame, project, unproject, type Camera } from './projection';

const ff = SENSORS[0];
const mft = SENSORS.find((s) => s.id === 'mft')!;
const apsc = SENSORS.find((s) => s.id === 'apsc')!;

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

  it('takes twice the pixel pitch under the pixel-pitch rule', () => {
    expect(cocMm(ff, 45_000_000, CocRule.PixelPitch)).toBeCloseTo(0.0088, 4);
    expect(cocMm(ff, null, CocRule.PixelPitch)).toBeCloseTo(0.03, 9);
    expect(cocMm(ff, 45_000_000, CocRule.Standard)).toBeCloseTo(0.03, 9);
  });
});

describe('depth of field', () => {
  it('reproduces a standard 50 mm f/8 example', () => {
    expect(hyperfocalM(50, 8, 0.03)).toBeCloseTo(10.47, 2);
    const d = depthOfField(50, 8, 0.03, 5);
    expect(d.nearM).toBeCloseTo(3.39, 2);
    expect(d.farM).toBeCloseTo(9.53, 2);
  });

  it('matches the PlanIt 400 mm f/8 worked example', () => {
    const MI = 1609.344;
    const d = depthOfField(400, 8, cocMm(ff, 45_000_000, CocRule.PixelPitch), 1.31 * MI);
    expect(d.nearM / MI).toBeCloseTo(0.68, 2);
    // PlanIt's far limit of 16.72 mi needs a CoC near 0.00875 mm; its displayed CoC and distance are rounded.
    expect(d.farM / MI).toBeGreaterThan(16);
    expect(d.farM / MI).toBeLessThan(17.5);
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

describe('teleconverter', () => {
  const bare = { focalMm: 600, fNumber: 4, teleconverters: [] as Teleconverter[] };

  it('multiplies focal length and f-number by the same factor', () => {
    expect(effectiveOptics(bare)).toEqual({ focalMm: 600, fNumber: 4 });
    expect(effectiveOptics({ ...bare, teleconverters: [Teleconverter.X14] })).toEqual({ focalMm: 840, fNumber: 5.6 });
    expect(effectiveOptics({ ...bare, teleconverters: [Teleconverter.X20] })).toEqual({ focalMm: 1200, fNumber: 8 });
  });

  it('stacks a 1.4× and a 2.0× into a 2.8×', () => {
    expect(tcFactor([])).toBe(1);
    expect(tcFactor([Teleconverter.X14, Teleconverter.X20])).toBe(2.8);
    expect(effectiveOptics({ ...bare, teleconverters: [Teleconverter.X14, Teleconverter.X20] })).toEqual({ focalMm: 1680, fNumber: 11.2 });
  });

  it('frames exactly like the longer lens it makes', () => {
    const f = effectiveOptics({ ...bare, teleconverters: [Teleconverter.X20] }).focalMm;
    expect(frameFov(ff, f, Orientation.Landscape).hDeg).toBeCloseTo(frameFov(ff, 1200, Orientation.Landscape).hDeg, 9);
  });

  it('caps the base focal so the product stays inside the frame range', () => {
    expect(clampBaseFocalMm(2400, 1)).toBe(2400);
    expect(clampBaseFocalMm(2400, Teleconverter.X20)).toBe(1200);
    expect(clampBaseFocalMm(2400, Teleconverter.X14)).toBeCloseTo(1714.3, 1);
    expect(clampBaseFocalMm(1, Teleconverter.X20)).toBe(4);
    expect(clampBaseFocalMm(2400, tcFactor([Teleconverter.X14, Teleconverter.X20]))).toBeCloseTo(857.1, 1);
  });
});

describe('lens limits', () => {
  const zoom: LensSpec = { id: 'l', name: 'FE 200-600mm', minMm: 200, maxMm: 600, maxAperture: 5.6, maxApertureLong: 6.3, mount: 'E' };
  const flat: LensSpec = { id: 'f', name: 'FE 70-200mm', minMm: 70, maxMm: 200, maxAperture: 2.8, mount: 'E' };

  it('keeps a zoom gesture inside the mounted lens', () => {
    expect(clampFocalMm(50, zoom, 1)).toBe(200);
    expect(clampFocalMm(5000, zoom, 1)).toBe(600);
    expect(clampFocalMm(400, zoom, 1)).toBe(400);
  });

  it('still applies the frame range without a lens', () => {
    expect(clampFocalMm(1, null, 1)).toBe(4);
    expect(clampFocalMm(2400, null, Teleconverter.X20)).toBe(1200);
  });

  it('runs the maximum aperture from end to end of a zoom', () => {
    expect(maxApertureAt(zoom, 200)).toBe(5.6);
    expect(maxApertureAt(zoom, 600)).toBe(6.3);
    expect(maxApertureAt(zoom, 400)).toBe(6);
  });

  it('holds at the endpoints outside the range and stays flat without a long end', () => {
    expect(maxApertureAt(zoom, 50)).toBe(5.6);
    expect(maxApertureAt(zoom, 5000)).toBe(6.3);
    expect(maxApertureAt(flat, 70)).toBe(2.8);
    expect(maxApertureAt(flat, 200)).toBe(2.8);
  });

  it('offers only the stops reachable at that focal length', () => {
    expect(aperturesFor(zoom, 200)[0]).toBe(5.6);
    expect(aperturesFor(zoom, 600)[0]).toBe(6.3);
    expect(aperturesFor(zoom, 600)).not.toContain(5.6);
  });
});

describe('crop', () => {
  it('narrows the frame by the crop factor at a fixed focal', () => {
    expect(cropFactor(apsc)).toBeCloseTo(1.534, 3);
    expect(frameFov(apsc, 600, Orientation.Landscape).hDeg).toBeCloseTo(fovDeg(apsc.widthMm, 600), 9);
    expect(frameFov(apsc, 600, Orientation.Landscape).hDeg).toBeLessThan(frameFov(ff, 600, Orientation.Landscape).hDeg);
    // The diagonal is what the crop factor is defined on, so it matches the equivalent focal exactly.
    expect(frameFov(apsc, 600, Orientation.Landscape).dDeg).toBeCloseTo(frameFov(ff, equivalentFocalMm(apsc, 600), Orientation.Landscape).dDeg, 9);
  });

  it('composes with a teleconverter', () => {
    const f = effectiveOptics({ focalMm: 600, fNumber: 4, teleconverters: [Teleconverter.X20] }).focalMm;
    expect(frameFov(apsc, f, Orientation.Landscape).dDeg).toBeCloseTo(frameFov(ff, equivalentFocalMm(apsc, 1200), Orientation.Landscape).dDeg, 9);
    expect(equivalentFocalMm(apsc, f)).toBeCloseTo(1840.7, 1);
  });
});

/** Elevation of an image point, straight from the projection, as the reference. */
const elAt = (pitchDeg: number, f: number, x: number, y: number) => {
  const p = (pitchDeg * Math.PI) / 180;
  return (Math.asin((y * Math.cos(p) + f * Math.sin(p)) / Math.hypot(f, x, y)) * 180) / Math.PI;
};

describe('frame elevation span', () => {
  it('a level frame is exactly pitch ± vfov / 2', () => {
    const span = frameElevationSpanDeg(0, 36, 24, 200);
    expect(span.maxDeg).toBeCloseTo(fovDeg(24, 200) / 2, 9);
    expect(span.minDeg).toBeCloseTo(-fovDeg(24, 200) / 2, 9);
  });

  it('a frame pitched up dips lower at its bottom corners than at its bottom centre', () => {
    const span = frameElevationSpanDeg(18.56, 36, 24, 200);
    // The naive band is not a bound: the corner sits below pitch − vfov / 2.
    expect(span.minDeg).toBeLessThan(18.56 - fovDeg(24, 200) / 2);
    expect(span.minDeg).toBeCloseTo(elAt(18.56, 200, 18, -12), 9);
    expect(span.maxDeg).toBeCloseTo(elAt(18.56, 200, 0, 12), 9);
  });

  it('brackets every point of the frame, at every pitch and focal length', () => {
    for (const pitchDeg of [-89, -45, -18.56, 0, 18.56, 60, 89])
      for (const f of [14, 70, 600, 2400]) {
        const span = frameElevationSpanDeg(pitchDeg, 36, 24, f);
        for (let u = -1; u <= 1; u += 0.1)
          for (let v = -1; v <= 1; v += 0.1) {
            const el = elAt(pitchDeg, f, u * 18, v * 12);
            expect(el).toBeLessThanOrEqual(span.maxDeg + 1e-9);
            expect(el).toBeGreaterThanOrEqual(span.minDeg - 1e-9);
          }
      }
  });
});

/** Azimuth of an image point relative to the frame centre, straight from the projection. */
const azAt = (pitchDeg: number, f: number, x: number, y: number) => {
  const p = (pitchDeg * Math.PI) / 180;
  return (Math.atan2(x, f * Math.cos(p) - y * Math.sin(p)) * 180) / Math.PI;
};

describe('frame azimuth half-width', () => {
  it('a level frame is exactly hfov / 2', () => {
    expect(frameAzimuthHalfDeg(0, 36, 24, 200)).toBeCloseTo(fovDeg(36, 200) / 2, 9);
  });

  it('a pitched frame splays wider than hfov / 2, at the rim it tilts towards', () => {
    const half = frameAzimuthHalfDeg(40, 36, 24, 24);
    expect(half).toBeGreaterThan(fovDeg(36, 24) / 2);
    expect(half).toBeCloseTo(azAt(40, 24, 18, 12), 9);
  });

  it('takes in every bearing once the top rim reaches the zenith', () => {
    // tan p = f / (h / 2): a 24 mm frame on full frame turns over at 63.435°.
    expect(frameAzimuthHalfDeg(63, 36, 24, 24)).toBeLessThan(180);
    expect(frameAzimuthHalfDeg(64, 36, 24, 24)).toBe(180);
    expect(frameAzimuthHalfDeg(-64, 36, 24, 24)).toBe(180);
  });

  it('brackets every point of the frame, at every pitch and focal length', () => {
    for (const pitchDeg of [-89, -45, -18.56, 0, 18.56, 60, 89])
      for (const f of [14, 70, 600, 2400]) {
        const half = frameAzimuthHalfDeg(pitchDeg, 36, 24, f);
        for (let u = -1; u <= 1; u += 0.1)
          for (let v = -1; v <= 1; v += 0.1) expect(Math.abs(azAt(pitchDeg, f, u * 18, v * 12))).toBeLessThanOrEqual(half + 1e-9);
      }
  });
});
