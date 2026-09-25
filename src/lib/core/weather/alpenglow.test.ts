import { describe, expect, it } from 'vitest';
import { distanceM, bearingDeg } from '@core/geo/geodesy';
import { binBearing, GLOW_KM, glowPoints, layerAt, pathOffset, scoreGlow, type GlowInput } from './alpenglow';
import { forecastBody } from './fixture';
import { CLOUD_VARS, HourlyVar, parseForecast, type PointSeries } from './openMeteo';

const T0 = Date.parse('2026-09-26T00:00:00Z');
const AT = T0 + 17.5 * 3_600_000;

type Cells = Partial<Record<HourlyVar, number | null>>;
/** One series per cell list, 24 h of the same values; unset vars are 0, visibility 20 km, code 0. */
function series(cells: Cells[]): PointSeries[] {
  const base: Cells = { [HourlyVar.Visibility]: 20_000, [HourlyVar.Code]: 0 };
  const pts = cells.map((_, i) => ({ lat: 46 + i * 0.1, lng: 7 }));
  return parseForecast(
    forecastBody(pts, '2026-09-26', 24, CLOUD_VARS, (v, _h, i) => (v in cells[i] ? cells[i][v]! : (base[v] ?? 0))),
    CLOUD_VARS
  );
}

function input(point: Cells, path: Cells[] = GLOW_KM.map(() => ({})), over: Partial<GlowInput> = {}): GlowInput {
  const [p, ...rest] = series([point, ...path]);
  return { groundM: 800, eyeM: 1.6, sunAltDeg: 2, ms: AT, point: p, path: rest, ...over };
}

describe('glowPoints', () => {
  it('puts the point first, then each bearing at 25–300 km along its geodesic', () => {
    const p = { lat: 45.9, lng: 6.9 };
    const pts = glowPoints(p, [90, 270]);
    expect(pts).toHaveLength(1 + 2 * GLOW_KM.length);
    expect(pts[0]).toEqual(p);
    GLOW_KM.forEach((km, i) => {
      expect(distanceM(p, pts[pathOffset(1) + i]) / 1000).toBeCloseTo(km, 1);
      expect(bearingDeg(p, pts[pathOffset(1) + i])).toBeCloseTo(270, 0);
    });
  });

  it('bins bearings to 2 degrees', () => {
    expect(binBearing(265.2)).toBe(266);
    expect(binBearing(359.4)).toBe(0);
    expect(binBearing(-0.6)).toBe(0);
  });
});

describe('layerAt', () => {
  it('follows the Open-Meteo bands', () => {
    expect(layerAt(500)).toBe('low');
    expect(layerAt(2500)).toBe('mid');
    expect(layerAt(7000)).toBeNull();
  });
});

describe('scoreGlow', () => {
  it('scores a clear sky 85 and says so', () => {
    expect(scoreGlow(input({}))).toEqual({ score: 85, reason: 'clear toward the Sun' });
  });

  it('gives the top score to some high cloud overhead', () => {
    expect(scoreGlow(input({ [HourlyVar.CloudHigh]: 40 }))).toEqual({ score: 100, reason: 'clear toward the Sun, high cloud 40% overhead' });
    expect(scoreGlow(input({ [HourlyVar.CloudHigh]: 95 })).score).toBe(85);
  });

  it('names low cloud on the sunlight path with its distance', () => {
    const path = GLOW_KM.map((km) => (km === 100 ? { [HourlyVar.CloudLow]: 80 } : {}));
    expect(scoreGlow(input({}, path, { sunAltDeg: 0 }))).toEqual({ score: 17, reason: 'low cloud 80% toward the Sun, 100 km' });
  });

  it('counts mid cloud only where the sunlight passes through the mid band', () => {
    const path = GLOW_KM.map((km) => (km === 200 ? { [HourlyVar.CloudMid]: 60, [HourlyVar.CloudLow]: 90 } : {}));
    // At 2° the ray is ~10.5 km up by 200 km: above both bands.
    expect(scoreGlow(input({}, path)).score).toBe(85);
    // At 0.2° it is ~4.2 km up there: in the mid band, over the low cloud.
    expect(scoreGlow(input({}, path, { sunAltDeg: 0.2 }))).toEqual({ score: 34, reason: 'mid cloud 60% toward the Sun, 200 km' });
  });

  it('ignores high cloud toward the Sun', () => {
    const path = GLOW_KM.map(() => ({ [HourlyVar.CloudHigh]: 100 }));
    expect(scoreGlow(input({}, path)).score).toBe(85);
  });

  it('hides the point under its own low cloud or fog', () => {
    expect(scoreGlow(input({ [HourlyVar.CloudLow]: 70 }))).toEqual({ score: 26, reason: 'low cloud 70% at the point' });
    expect(scoreGlow(input({ [HourlyVar.Code]: 45 }))).toEqual({ score: 0, reason: 'fog at the point' });
    expect(scoreGlow(input({ [HourlyVar.Visibility]: 400 }))).toEqual({ score: 0, reason: 'fog at the point' });
  });

  it('uses the mid band at the point above 2 km, and nothing above 6 km', () => {
    const cells = { [HourlyVar.CloudLow]: 100, [HourlyVar.CloudMid]: 50 };
    expect(scoreGlow(input(cells, undefined, { groundM: 3000 }))).toEqual({ score: 43, reason: 'mid cloud 50% at the point' });
    expect(scoreGlow(input(cells, undefined, { groundM: 6500 })).score).toBe(85);
  });

  it('never reads a gap as clear', () => {
    expect(scoreGlow(input({ [HourlyVar.CloudLow]: null }))).toEqual({ score: null, reason: 'no forecast for this time' });
    const path = GLOW_KM.map((km) => (km === 25 ? { [HourlyVar.CloudLow]: null } : {}));
    expect(scoreGlow(input({}, path)).score).toBeNull();
    expect(scoreGlow(input({}, undefined, { ms: T0 + 30 * 3_600_000 })).score).toBeNull();
  });

  it('treats a model without visibility as fog-blind, not missing', () => {
    expect(scoreGlow(input({ [HourlyVar.Visibility]: null })).score).toBe(85);
  });
});
