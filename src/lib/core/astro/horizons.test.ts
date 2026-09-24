import { describe, expect, it } from 'vitest';
import { makeObserver, siteHeightM, SkyBody } from './bodies';
import { dayEvents, EventKind } from './dayEvents';
import { position } from './positions';
import { applyStar, horizontalOf, starFrame } from './skyFrame';
import { eqjVector } from './stars';

// Reference values from JPL Horizons observer tables (apparent, REFRACTED; events from AIRLESS upper limb at −34′).
const D2R = Math.PI / 180;
const sepDeg = (az1: number, el1: number, az2: number, el2: number) =>
  Math.acos(Math.min(1, Math.sin(el1 * D2R) * Math.sin(el2 * D2R) + Math.cos(el1 * D2R) * Math.cos(el2 * D2R) * Math.cos((az1 - az2) * D2R))) / D2R;

describe('position vs JPL Horizons', () => {
  it.each([
    ['Gornergrat sun', SkyBody.Sun, 45.9837, 7.7847, 3089, '2024-06-21T15:00:00Z', 260.065134, 42.542062],
    ['Cape Town sun', SkyBody.Sun, -33.9249, 18.4241, 10, '2001-03-20T08:00:00Z', 59.57438, 37.127407],
    ['Tromsø moon', SkyBody.Moon, 69.6492, 18.9553, 10, '2026-09-24T21:00:00Z', 176.955081, 12.264838],
    ['Quito moon', SkyBody.Moon, -0.2201, -78.5123, 2850, '2012-12-21T20:00:00Z', 78.509771, 24.92547]
  ] as const)('%s within 0.002°', (_, body, lat, lng, h, iso, az, el) => {
    const p = position(body, new Date(iso), makeObserver({ lat, lng }, h));
    expect(sepDeg(p.azimuth, p.altitude, az, el)).toBeLessThan(0.002);
  });

  it.each([
    ['2026-10-26T21:52:00Z', 252.616095824, 1.002051512],
    ['2026-10-26T21:56:00Z', 253.269103077, 0.373838897],
    ['2026-10-26T22:00:00Z', 253.91936165, -0.233574942]
  ] as const)('New York sun at the horizon, %s, within 5″', (iso, az, el) => {
    const p = position(SkyBody.Sun, new Date(iso), makeObserver({ lat: 40.747952, lng: -74.023685 }, 3));
    expect(sepDeg(p.azimuth, p.altitude, az, el)).toBeLessThan(5 / 3600);
  });
});

// Astropy 7 AltAz with pressure 0 (J2000 place, no proper motion): aberration is up to 20″ of it.
describe('catalogue stars vs astropy', () => {
  it.each([
    ['Altair', '2026-06-21T00:00:00Z', 297.6958273, 8.8683212, 145.729257, 49.318091],
    ['Altair', '2026-06-21T03:00:00Z', 297.6958273, 8.8683212, 216.324629, 48.706028],
    ['Capella', '2026-03-20T22:00:00Z', 79.17232794, 45.99799147, 299.987372, 39.007488],
    ['Arcturus', '2026-03-20T22:00:00Z', 213.9153003, 19.18240916, 98.133487, 35.258536],
    ['Capella', '2026-12-21T20:00:00Z', 79.17232794, 45.99799147, 72.680818, 60.707613]
  ] as const)('%s at %s within 2″', (_, iso, ra, dec, az, el) => {
    const out = new Float64Array(3);
    const [x, y, z] = eqjVector(ra, dec);
    applyStar(starFrame(new Date(iso), makeObserver({ lat: 45, lng: 7 })), x, y, z, out);
    const h = horizontalOf(out[0], out[1], out[2], false);
    expect(sepDeg(h.azimuthDeg, h.altitudeDeg, az, el)).toBeLessThan(2 / 3600);
  });
});

describe('rise/set vs JPL Horizons', () => {
  it.each([
    ['Queenstown sunrise', SkyBody.Sun, EventKind.Rise, -45.0312, 168.6626, '2031-11-13T17:08:14.977Z'],
    ['Queenstown sunset', SkyBody.Sun, EventKind.Set, -45.0312, 168.6626, '2031-11-14T07:51:48.711Z'],
    ['Tromsø moonrise', SkyBody.Moon, EventKind.Rise, 69.6492, 18.9553, '2026-09-24T16:38:07.964Z'],
    ['Tromsø moonset', SkyBody.Moon, EventKind.Set, 69.6492, 18.9553, '2026-09-24T00:10:53.667Z']
  ] as const)('%s within 5 s', (_, body, kind, lat, lng, iso) => {
    const t = Date.parse(iso);
    const ev = dayEvents(makeObserver({ lat, lng }), t - 6 * 3600e3, t + 6 * 3600e3).find((e) => e.body === body && e.kind === kind);
    expect(ev).toBeDefined();
    expect(Math.abs(ev!.time - t)).toBeLessThan(5000);
  });
});

// Horizons AIRLESS upper limb at 46° N 7.75° E, 3000 m, crossing −dip(1.6 m) − 34′·ρ(3000 m) = −0.4643°.
describe('rise/set on a 3000 m plateau vs JPL Horizons', () => {
  const obs = makeObserver({ lat: 46, lng: 7.75 }, siteHeightM(3000, 1.6));
  it.each([
    [EventKind.Rise, '2026-06-21T03:38:55.596Z'],
    [EventKind.Set, '2026-06-21T19:22:41.659Z']
  ] as const)('sun %s within 2 s', (kind, iso) => {
    const t = Date.parse(iso);
    const ev = dayEvents(obs, t - 6 * 3600e3, t + 6 * 3600e3, { heightAboveGroundM: 1.6 }).find((e) => e.body === SkyBody.Sun && e.kind === kind);
    expect(ev).toBeDefined();
    expect(Math.abs(ev!.time - t)).toBeLessThan(2000);
  });

  it('finds rise/set below sea level', () => {
    const dead = makeObserver({ lat: 31.5, lng: 35.5 }, siteHeightM(-600, 1.6));
    const t = Date.parse('2026-06-21T12:00:00Z');
    expect(dayEvents(dead, t - 12 * 3600e3, t + 12 * 3600e3, { heightAboveGroundM: 1.6 }).some((e) => e.kind === EventKind.Set)).toBe(true);
  });
});
