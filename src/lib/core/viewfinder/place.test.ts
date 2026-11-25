import { describe, expect, it } from 'vitest';
import { cameraBasis, type Camera } from '@core/optics/projection';
import { flatHorizonDeg } from '@core/terrain/los';
import type { ViewProfile } from '@core/terrain/view';
import { behindBuilding, hiddenBySkyline, inView, placeEnu, surfaceAngle, toPx, type PlaceView } from './place';

const D2R = Math.PI / 180;
const enu = (azDeg: number, altDeg: number) => [Math.cos(altDeg * D2R) * Math.sin(azDeg * D2R), Math.cos(altDeg * D2R) * Math.cos(azDeg * D2R), Math.sin(altDeg * D2R)] as const;

const scene = (elevationDeg: number, view: ViewProfile | null = null): PlaceView => {
  const cam: Camera = { azimuthDeg: 90, elevationDeg, focalMm: 50, frameWmm: 36, frameHmm: 24 };
  const frame = { x: 0, y: 0, w: 360, h: 240, pxPerMm: 10 };
  return { cam, basis: cameraBasis(cam), frame, area: { x: 0, y: 0, w: 360, h: 240 }, view, eyeAboveGroundM: 2, airDensity: 1, maxSkyline: view ? 5 : flatHorizonDeg(2) };
};

/** One column per degree from 0° with a single visible point at 1 km and the given skyline. */
const flatView = (skylineDeg: number): ViewProfile => {
  const nAz = 360;
  const start = new Int32Array(nAz + 1).map((_, i) => i);
  return { azFromDeg: 0, azStepDeg: 1, nAz, start, angleDeg: new Float32Array(nAz).fill(-1), distM: new Float32Array(nAz).fill(1000), skylineDeg: new Float32Array(nAz).fill(skylineDeg), skylineDistM: new Float32Array(nAz).fill(1000), rangeM: 10_000 };
};

const always = { occludes: () => true };

describe('toPx and inView', () => {
  it('puts the aim at the frame centre', () => {
    const p = toPx(scene(0), 90, 0)!;
    expect(p.x).toBeCloseTo(180, 6);
    expect(p.y).toBeCloseTo(120, 6);
  });

  it('returns null behind the camera', () => {
    expect(toPx(scene(0), 270, 0)).toBeNull();
  });

  it('grows the area by the slack', () => {
    const sc = scene(0);
    expect(inView(sc, { x: -5, y: 10 })).toBe(false);
    expect(inView(sc, { x: -5, y: 10 }, 5)).toBe(true);
    expect(inView(sc, null, 100)).toBe(false);
  });
});

describe('placeEnu', () => {
  it('drops directions well below the horizon', () => {
    expect(placeEnu(scene(0), null, ...enu(90, -10), 0)).toBeNull();
  });

  it('lifts a low direction by refraction', () => {
    const p = placeEnu(scene(0), null, ...enu(90, 2), 0)!;
    expect(p.altDeg).toBeGreaterThan(2);
    expect(p.y).toBeLessThan(120);
  });

  it('projects a high direction through the basis, near the frame centre', () => {
    const p = placeEnu(scene(30), null, ...enu(90, 30), 0)!;
    expect(p.x).toBeCloseTo(180, 3);
    expect(p.y).toBeLessThan(120);
    expect(p.y).toBeGreaterThan(115);
  });

  it('hides behind the skyline but not above it', () => {
    const sc = scene(0, flatView(3));
    expect(placeEnu(sc, null, ...enu(90, 1), 0)!.hidden).toBe(true);
    expect(placeEnu(sc, null, ...enu(90, 6), 0)!.hidden).toBe(false);
  });

  it('tests buildings only when asked', () => {
    const sc = scene(0);
    expect(placeEnu(sc, always, ...enu(90, 5), 0)!.hidden).toBe(true);
    expect(placeEnu(sc, always, ...enu(90, 5), 0, false)!.hidden).toBe(false);
  });

  it('drops a direction outside the area plus slack', () => {
    expect(placeEnu(scene(0), null, ...enu(150, 5), 0)).toBeNull();
  });
});

describe('skyline and surface', () => {
  it('falls back to the flat horizon without a sweep', () => {
    const sc = scene(0);
    const h = flatHorizonDeg(2);
    expect(hiddenBySkyline(sc, 90, h - 0.01)).toBe(true);
    expect(hiddenBySkyline(sc, 90, h + 0.01)).toBe(false);
    expect(surfaceAngle(sc, 90, 500)).toBe(h);
  });

  it('reads the sweep column', () => {
    const sc = scene(0, flatView(3));
    expect(hiddenBySkyline(sc, 90, 2)).toBe(true);
    expect(surfaceAngle(sc, 90, 2000)).toBe(-1);
  });
});

describe('behindBuilding', () => {
  it('is false without an occluder', () => {
    expect(behindBuilding(null, 0, 0, Infinity)).toBe(false);
  });

  it('asks the occluder along the direction', () => {
    const seen: number[][] = [];
    behindBuilding({ occludes: (e, n, u, d) => (seen.push([e, n, u, d]), true) }, 90, 0, 50);
    expect(seen[0][0]).toBeCloseTo(1, 9);
    expect(seen[0][1]).toBeCloseTo(0, 9);
    expect(seen[0][2]).toBeCloseTo(0, 9);
    expect(seen[0][3]).toBe(50);
  });
});
