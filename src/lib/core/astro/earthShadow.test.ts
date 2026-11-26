import { Body, Observer, SearchAltitude } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { cloudSunlit, depressionForHeightDeg, lastLightMs, litHeightM, sunAltitudeAtDeg } from './earthShadow';

describe("Earth's shadow on clouds", () => {
  it('Minnaert, Light and Colour in the Outdoors: overhead lit height h = R(sec δ − 1), 35 km at civil dusk', () => {
    expect(litHeightM(-6) / 1000).toBeCloseTo(35.1, 1);
    expect(litHeightM(-1)).toBeCloseTo(970, -1);
    expect(litHeightM(5)).toBe(0);
  });

  it('a 10 km cirrus stays lit until the sun is 3.2° down', () => {
    expect(depressionForHeightDeg(10_000)).toBeCloseTo(3.21, 2);
    expect(litHeightM(-depressionForHeightDeg(10_000))).toBeCloseTo(10_000, 3);
  });

  it('clouds toward the sun keep the light longer than those opposite', () => {
    const sun = { altitudeDeg: -3, azimuthDeg: 270 };
    expect(sunAltitudeAtDeg(-3, 270, 270, 111_195)).toBeCloseTo(-2, 2);
    expect(cloudSunlit(3000, 200_000, 270, sun)).toBe(true);
    expect(cloudSunlit(3000, 200_000, 90, sun)).toBe(false);
  });

  it('at the equator on an equinox a 10 km cloud stays lit about 13 min past geometric sunset (15°/h)', () => {
    const obs = new Observer(0, 0, 0);
    const from = Date.UTC(2025, 2, 20, 12);
    const sunset = SearchAltitude(Body.Sun, obs, -1, new Date(from), 1, 0)!.date.getTime();
    const last = lastLightMs(obs, from, 10_000)!;
    expect((last - sunset) / 60_000).toBeCloseTo(12.8, 0);
  });
});

describe('PlanIt cloud distance guide', () => {
  const FT = 0.3048;
  const R = 6371008.8;
  const horizon = (h: number) => Math.sqrt(2 * R * h);
  const lit = (h: number, sunAlt: number) => cloudSunlit(h, horizon(h), 270, { altitudeDeg: sunAlt, azimuthDeg: 270 });

  it('a 20,000 ft cloud on the sunset horizon stays lit until the sun is −5.0°, not −7.5°', () => {
    const h = 20000 * FT;
    expect(lit(h, -4.98)).toBe(true);
    expect(lit(h, -5.02)).toBe(false);
    expect(lit(h, -7.5)).toBe(false);
  });

  it('a 13,000 ft cloud on the sunset horizon stays lit until the sun is −4.0°, not −6.1°', () => {
    const h = 13000 * FT;
    expect(lit(h, -4.0)).toBe(true);
    expect(lit(h, -4.1)).toBe(false);
    expect(lit(h, -6.1)).toBe(false);
  });

  it('a cloud 519 mi out (3 × the 20,000 ft horizon) blocks the sun for a 20,000 ft cloud on the horizon', () => {
    const d = horizon(20000 * FT);
    expect((3 * d) / 1609.344).toBeCloseTo(519, -1);
    expect(sunAltitudeAtDeg(-5.0, 270, 270, 2 * d)).toBeCloseTo(0, 1);
  });
});
