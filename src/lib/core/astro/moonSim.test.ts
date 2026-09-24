import { describe, expect, it } from 'vitest';
import { Equator, Body, SiderealTime } from 'astronomy-engine';
import { makeObserver } from './bodies';
import { moonView } from './moonSim';

// JPL Horizons, target 301 from Zermatt (7.7491 E, 46.0207 N, 1608 m), airless apparent, quantities 2, 10, 13, 14, 17.
const HORIZONS = [
  { utc: '2026-10-13T17:00Z', ra: 231.720011848, dec: -24.934808503, sunRa: 198.817194217, sunDec: -7.962882055, illu: 9.42801, diamArcsec: 1799.087, lon: 3.052088, lat: 7.522155, sunLon: 147.717512, sunLat: -1.25411, np: 14.3182 },
  { utc: '2026-10-18T18:00Z', ra: 298.672193765, dec: -24.413936897, sunRa: 203.516930151, sunDec: -9.816633737, illu: 50.64191, diamArcsec: 1789.815, lon: 357.053879, lat: 4.342608, sunLon: 86.216053, sunLat: -1.31544, np: 350.3141 },
  { utc: '2026-10-26T04:00Z', ra: 28.117098648, dec: 16.051270665, sunRa: 210.552243818, sunDec: -12.428548816, illu: 99.85833, diamArcsec: 1955.991, lon: 355.014502, lat: -5.595619, sunLon: 356.023052, sunLat: -1.400528, np: 340.0621 },
  { utc: '2026-10-03T05:00Z', ra: 96.075984099, dec: 27.178430629, sunRa: 189.200922434, sunDec: -3.96623035, illu: 54.1198, diamArcsec: 1970.247, lon: 1.276796, lat: -5.05047, sunLon: 275.930467, sunLat: -1.03594, np: 1.4846 }
];

const obs = makeObserver({ lat: 46.0207, lng: 7.7491 }, 1608);
const D = Math.PI / 180;
const angDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

/** Position angle of the second point seen from the first, spherical formula. */
function pa(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const da = (ra2 - ra1) * D;
  const y = Math.cos(dec2 * D) * Math.sin(da);
  const x = Math.sin(dec2 * D) * Math.cos(dec1 * D) - Math.cos(dec2 * D) * Math.sin(dec1 * D) * Math.cos(da);
  return ((Math.atan2(y, x) / D) % 360 + 360) % 360;
}

describe('moon simulator against JPL Horizons', () => {
  for (const h of HORIZONS) {
    it(`matches libration, axis and bright limb on ${h.utc} within 0.2°`, () => {
      const v = moonView(new Date(h.utc), obs);
      expect(angDiff(v.librationLonDeg, h.lon)).toBeLessThan(0.2);
      expect(Math.abs(v.librationLatDeg - h.lat)).toBeLessThan(0.2);
      expect(angDiff(v.subSolarLonDeg, h.sunLon)).toBeLessThan(0.2);
      expect(Math.abs(v.subSolarLatDeg - h.sunLat)).toBeLessThan(0.2);
      expect(angDiff(v.axisPaDeg, h.np)).toBeLessThan(0.2);
      expect(angDiff(v.brightLimbPaDeg, pa(h.ra, h.dec, h.sunRa, h.sunDec))).toBeLessThan(0.2);
      expect(v.illumination).toBeCloseTo(h.illu / 100, 2);
      expect(Math.abs(v.semidiameterDeg * 7200 - h.diamArcsec)).toBeLessThan(2);
    });
  }

  it('flags earthshine for the crescent only and tells waxing from waning', () => {
    const [crescent, quarter, full, last] = HORIZONS.map((h) => moonView(new Date(h.utc), obs));
    expect([crescent.earthshine, quarter.earthshine, full.earthshine, last.earthshine]).toEqual([true, false, false, false]);
    expect([crescent.waxing, quarter.waxing, last.waxing]).toEqual([true, true, false]);
  });
});

describe('moon orientation', () => {
  it('gives the textbook parallactic angle', () => {
    for (const h of HORIZONS) {
      const date = new Date(h.utc);
      const eq = Equator(Body.Moon, date, obs, true, true);
      const ha = (SiderealTime(date) * 15 + obs.longitude - eq.ra * 15) * D;
      const q = Math.atan2(Math.sin(ha), Math.tan(obs.latitude * D) * Math.cos(eq.dec * D) - Math.sin(eq.dec * D) * Math.cos(ha)) / D;
      expect(angDiff(moonView(date, obs).parallacticDeg, q)).toBeLessThan(0.05);
    }
  });

  it('maps the direction to the observer onto the libration point', () => {
    const v = moonView(new Date(HORIZONS[1].utc), obs);
    const m = v.enuToBody;
    // Horizons elevation 19.332°, azimuth 186.095° for this row.
    const alt = 19.332104261 * D;
    const az = 186.094761239 * D;
    const toObs = [-Math.cos(alt) * Math.sin(az), -Math.cos(alt) * Math.cos(az), -Math.sin(alt)];
    const b = [0, 1, 2].map((i) => m[i * 3] * toObs[0] + m[i * 3 + 1] * toObs[1] + m[i * 3 + 2] * toObs[2]);
    expect(angDiff(Math.atan2(b[1], b[0]) / D, HORIZONS[1].lon)).toBeLessThan(0.2);
    expect(Math.abs(Math.asin(b[2]) / D - HORIZONS[1].lat)).toBeLessThan(0.2);
  });

  it('points the sun vector at the sub-solar point', () => {
    const v = moonView(new Date(HORIZONS[0].utc), obs);
    const m = v.enuToBody;
    const s = v.sunFromMoonEnu;
    const b = [0, 1, 2].map((i) => m[i * 3] * s[0] + m[i * 3 + 1] * s[1] + m[i * 3 + 2] * s[2]);
    expect(angDiff(Math.atan2(b[1], b[0]) / D, HORIZONS[0].sunLon)).toBeLessThan(0.2);
  });
});
