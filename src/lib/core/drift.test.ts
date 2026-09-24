import type { FeatureCollection } from 'geojson';
import { describe, expect, it } from 'vitest';
import { linesShiftPx, onlyChanged, skyAngleDeg, skyDriftPx } from './drift';

const lines = (coords: [number, number][][], color = 'red'): FeatureCollection => ({
  type: 'FeatureCollection',
  features: coords.map((c) => ({ type: 'Feature', properties: { color }, geometry: { type: 'LineString', coordinates: c } }))
});
const identity = ([x, y]: [number, number]) => ({ x, y });
const noop = () => 0;

describe('onlyChanged', () => {
  it('sees a clock-only update', () => {
    expect(onlyChanged({ time: 1, pin: 'a', f: noop }, { time: 2, pin: 'a', f: noop }, 'time')).toBe(true);
  });

  it('sees any other key change', () => {
    expect(onlyChanged({ time: 1, pin: 'a' }, { time: 2, pin: 'b' }, 'time')).toBe(false);
  });
});

describe('skyAngleDeg', () => {
  it('measures along an azimuth circle shrunk by altitude', () => {
    expect(skyAngleDeg(0, 0, 0, 10)).toBeCloseTo(10, 9);
    expect(skyAngleDeg(60, 0, 60, 10)).toBeCloseTo(5, 1);
    expect(skyAngleDeg(10, 0, 12, 0)).toBeCloseTo(2, 9);
  });
});

describe('skyDriftPx', () => {
  it('moves a centre point at the sidereal rate', () => {
    expect(skyDriftPx(3_600_000, 1, 0)).toBeCloseTo(15.1, 9);
  });

  it('stretches toward the corners', () => {
    expect(skyDriftPx(1000, 20, 45)).toBeCloseTo(2 * skyDriftPx(1000, 20, 0), 9);
  });
});

describe('linesShiftPx', () => {
  it('is the largest on-screen vertex move', () => {
    const a = lines([[[10, 10], [20, 20]]]);
    const b = lines([[[10, 10], [20.3, 20.4]]]);
    expect(linesShiftPx(a, b, identity, 100, 100)).toBeCloseTo(0.5, 9);
  });

  it('ignores vertices far off screen but keeps the one past the edge', () => {
    const a = lines([[[50, 50], [150, 50], [250, 50]]]);
    const b = lines([[[50, 50], [150, 53], [250, 90]]]);
    expect(linesShiftPx(a, b, identity, 100, 100)).toBeCloseTo(3, 9);
  });

  it('is infinite when lines appear, vanish or restyle', () => {
    const a = lines([[[1, 1], [2, 2]]]);
    expect(linesShiftPx(a, lines([]), identity, 100, 100)).toBe(Infinity);
    expect(linesShiftPx(a, lines([[[1, 1], [2, 2]]], 'blue'), identity, 100, 100)).toBe(Infinity);
  });
});
