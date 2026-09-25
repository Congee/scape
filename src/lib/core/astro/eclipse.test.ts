import { EclipseKind } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import type { HorizonProfile } from '@core/terrain/horizon';
import { makeObserver } from './bodies';
import { ContactKind, lunarCircumstances, lunarEclipseLight, shadowLight, solarCircumstances, type EclipseContact } from './eclipse';

const dms = (d: number, m: number) => Math.sign(d) * (Math.abs(d) + m / 60);
// Both sides share the geometry; what is left is astronomy-engine's ephemeris against NASA's.
const TOL_MS = 10_000;
const utc = (s: string) => Date.parse(`${s}Z`);

type Expected = [ContactKind, string, number?, number?];

function expectContacts(got: EclipseContact[], want: Expected[]) {
  expect(got.map((c) => c.kind)).toEqual(want.map((w) => w[0]));
  want.forEach(([, t, alt, az], i) => {
    expect(Math.abs(got[i].timeMs - utc(t))).toBeLessThanOrEqual(TOL_MS);
    // NASA quotes geometric altitudes; ours carry refraction, a few arcminutes up here.
    if (alt !== undefined) expect(got[i].altitude).toBeCloseTo(alt, 0);
    if (az !== undefined) expect(Math.abs(got[i].azimuth - az)).toBeLessThan(0.2);
  });
}

describe('solarCircumstances', () => {
  it('matches NASA GSFC (Espenak, JSEX) for Reykjavik, 2026-08-12 total', () => {
    const obs = makeObserver({ lat: dms(64, 9), lng: dms(-21, 51) }, 28);
    const c = solarCircumstances(obs, utc('2026-08-11T00:00:00'));
    expect(c.kind).toBe(EclipseKind.Total);
    expect(Math.abs(c.magnitude - 1.0382)).toBeLessThanOrEqual(0.001);
    expect(c.obscuration).toBe(1);
    expectContacts(c.contacts, [
      [ContactKind.C1, '2026-08-12T16:47:09.7', 30.55, 237.48],
      [ContactKind.C2, '2026-08-12T17:48:16.4', 24.51, 252.7],
      [ContactKind.Max, '2026-08-12T17:48:42.7', 24.47],
      [ContactKind.C3, '2026-08-12T17:49:08.9'],
      [ContactKind.C4, '2026-08-12T18:47:33.4', 18.16, 266.51]
    ]);
  });

  it('matches NASA GSFC (Espenak, JSEX) for Madrid, 2026-08-12 partial ending after sunset', () => {
    const obs = makeObserver({ lat: dms(40, 24), lng: dms(-3, 41) }, 667);
    const c = solarCircumstances(obs, utc('2026-08-11T00:00:00'));
    expect(c.kind).toBe(EclipseKind.Partial);
    expect(Math.abs(c.magnitude - 0.9987)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(c.obscuration - 0.9996)).toBeLessThanOrEqual(0.001);
    expectContacts(c.contacts.slice(0, 2), [
      [ContactKind.C1, '2026-08-12T17:36:42.3', 17.64, 274.67],
      [ContactKind.Max, '2026-08-12T18:32:19.4', 7.18, 283.33]
    ]);
    expect(c.contacts[2].kind).toBe(ContactKind.C4);
    expect(c.contacts[2].visible).toBe(false);
  });

  it('matches NASA GSFC (Espenak, JSEX) for Dallas, 2024-04-08 total', () => {
    const obs = makeObserver({ lat: dms(32, 46), lng: dms(-96, 47) }, 168);
    const c = solarCircumstances(obs, utc('2024-04-07T00:00:00'));
    expect(c.kind).toBe(EclipseKind.Total);
    expect(Math.abs(c.magnitude - 1.0558)).toBeLessThanOrEqual(0.001);
    expectContacts(c.contacts, [
      [ContactKind.C1, '2024-04-08T17:23:12.2', 60.58, 145.28],
      [ContactKind.C2, '2024-04-08T18:40:36.6'],
      [ContactKind.Max, '2024-04-08T18:42:32.6', 64.63],
      [ContactKind.C3, '2024-04-08T18:44:28.6'],
      [ContactKind.C4, '2024-04-08T20:02:35.4', 56.75]
    ]);
  });

  it('hides a contact behind a skyline higher than the sun', () => {
    const obs = makeObserver({ lat: dms(40, 24), lng: dms(-3, 41) }, 667);
    const wall: HorizonProfile = { azStepDeg: 1, angleDeg: new Float32Array(360).fill(10), distM: new Float32Array(360), rangeM: 1 };
    const c = solarCircumstances(obs, utc('2026-08-11T00:00:00'), wall);
    expect(c.contacts.map((x) => x.visible)).toEqual([true, false, false]);
    expect(c.contacts[0].skylineDeg).toBeCloseTo(10, 5);
  });
});

// NASA GSFC JSEX local circumstances (Espenak): date, lat, lng, height, kind, magnitude, C1, C2, Max, C3, C4 (UT; null when absent or after sunset).
const JSEX: [string, number, number, number, EclipseKind, number, string, string | null, string, string | null, string | null][] = [
  ['2024-04-08', 23.2494, -106.4111, 10, EclipseKind.Total, 1.0565, '16:51:22.3', '18:07:24.9', '18:09:33.0', '18:11:41.3', '19:32:05.3'],
  ['2024-04-08', 25.5428, -103.4068, 1120, EclipseKind.Total, 1.0566, '16:59:51.1', '18:16:50.9', '18:18:56.1', '18:21:01.4', '19:41:22.9'],
  ['2024-04-08', 44.4759, -73.2121, 61, EclipseKind.Total, 1.0509, '18:14:08.8', '19:26:01.4', '19:27:39.4', '19:29:16.9', '20:37:14.7'],
  ['2024-04-08', 40.7128, -74.006, 10, EclipseKind.Partial, 0.9107, '18:10:29.8', null, '19:25:29.3', null, '20:36:18.5'],
  ['2024-10-02', -27.1127, -109.3497, 50, EclipseKind.Annular, 0.9324, '17:23:45.5', '19:04:11.0', '19:07:12.0', '19:10:13.1', '20:52:21.5'],
  ['2026-08-12', 43.3614, -5.8494, 232, EclipseKind.Total, 1.0337, '17:31:15.4', '18:27:00.5', '18:27:54.8', '18:28:48.8', '19:21:00.5'],
  ['2026-08-12', 39.4699, -0.3763, 15, EclipseKind.Total, 1.0319, '17:38:19.7', '18:32:25.5', '18:32:54.9', '18:33:24.1', null],
  ['2026-08-12', 38.7223, -9.1393, 50, EclipseKind.Partial, 0.9494, '17:39:13.8', null, '18:36:03.2', null, '19:29:03.0'],
  ['2027-08-02', 36.5271, -6.2886, 10, EclipseKind.Total, 1.0718, '07:40:38.0', '08:45:17.4', '08:46:43.8', '08:48:10.9', '09:59:27.2'],
  ['2027-08-02', 25.6872, 32.6396, 89, EclipseKind.Total, 1.079, '08:40:07.2', '10:01:57.9', '10:05:08.1', '10:08:17.9', '11:26:25.2'],
  ['2027-08-02', 51.5074, -0.1278, 20, EclipseKind.Partial, 0.5178, '08:03:30.1', null, '09:00:01.8', null, '09:59:22.4']
];

describe('solarCircumstances against NASA JSEX', () => {
  it.each(JSEX)('%s at %f, %f (%i m)', (day, lat, lng, h, kind, mag, ...times) => {
    const c = solarCircumstances(makeObserver({ lat, lng }, h), utc(`${day}T00:00:00`) - 86_400_000);
    expect(c.kind).toBe(kind);
    expect(Math.abs(c.magnitude - mag)).toBeLessThanOrEqual(0.001);
    const kinds = [ContactKind.C1, ContactKind.C2, ContactKind.Max, ContactKind.C3, ContactKind.C4];
    kinds.forEach((k, i) => {
      const got = c.contacts.find((x) => x.kind === k);
      const want = times[i];
      if (want === null) {
        if (k === ContactKind.C2 || k === ContactKind.C3) expect(got).toBeUndefined();
        return;
      }
      expect(Math.abs(got!.timeMs - utc(`${day}T${want}`))).toBeLessThanOrEqual(TOL_MS);
    });
  });
});

// NASA GSFC lunar eclipse plots (Espenak, Danjon rule): P1 U1 U2 Max U3 U4 P4, penumbral and umbral magnitudes.
const LUNAR: [string, string, number, number][] = [
  ['2025-09-07', '15:28:21 16:27:02 17:30:41 18:11:43.1 18:52:47 19:56:26 20:55:00', 2.344, 1.3619],
  ['2026-03-03', '08:44:22 09:50:00 11:04:26 11:33:37.0 12:02:45 13:17:10 14:22:59', 2.1838, 1.1507],
  ['2028-12-31', '14:03:49 15:07:35 16:16:19 16:51:58.2 17:27:40 18:36:24 19:40:02', 2.2742, 1.2463],
  ['2029-06-26', '00:34:34 01:32:18 02:31:08 03:22:05.3 04:13:01 05:11:50 06:09:42', 2.8266, 1.8436]
];

describe('lunarCircumstances against NASA', () => {
  it.each(LUNAR)('%s', (day, times, pen, umb) => {
    const c = lunarCircumstances(makeObserver({ lat: 0, lng: 0 }), utc(`${day}T00:00:00`) - 86_400_000);
    expect(c.kind).toBe(EclipseKind.Total);
    expect(Math.abs(c.penumbralMagnitude - pen)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(c.umbralMagnitude - umb)).toBeLessThanOrEqual(0.001);
    expect(c.contacts.map((x) => x.kind)).toEqual([ContactKind.P1, ContactKind.U1, ContactKind.U2, ContactKind.Max, ContactKind.U3, ContactKind.U4, ContactKind.P4]);
    // 2028-12-31 P1 is the worst at 6.9 s.
    times.split(' ').forEach((t, i) => expect(Math.abs(c.contacts[i].timeMs - utc(`${day}T${t}`))).toBeLessThanOrEqual(8_000));
  });

  it('finds a partial eclipse without totality', () => {
    const c = lunarCircumstances(makeObserver({ lat: 0, lng: 0 }), utc('2026-08-20T00:00:00'));
    expect(c.kind).toBe(EclipseKind.Partial);
    expect(c.contacts.map((x) => x.kind)).toEqual([ContactKind.P1, ContactKind.U1, ContactKind.Max, ContactKind.U4, ContactKind.P4]);
  });
});

describe('lunar eclipse light', () => {
  it('is full outside the penumbra and zero direct sun inside the umbra', () => {
    expect(shadowLight(1.3, 0.7, 1.25).sun).toBe(1);
    expect(shadowLight(0.5, 0.7, 1.25).sun).toBe(0);
    const mid = shadowLight(0.975, 0.7, 1.25).sun;
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });

  it('grows monotonically from the axis to the penumbra edge', () => {
    let last = 0;
    for (let r = 0; r <= 1.3; r += 0.01) {
      const l = shadowLight(r, 0.7, 1.25);
      expect(l.sun + l.glow).toBeGreaterThanOrEqual(last - 1e-12);
      last = l.sun + l.glow;
    }
  });

  it('dims the moonlight through 2025-09-07 about as observed', () => {
    const at = (t: string) => lunarEclipseLight(new Date(utc(`2025-09-07T${t}`)));
    expect(at('14:00:00')).toBe(1);
    // Mid-penumbral, before U1: a small dip the eye barely sees.
    expect(at('16:00:00')).toBeGreaterThan(0.5);
    expect(at('16:00:00')).toBeLessThan(0.95);
    // Totality: 8 to 11 magnitudes below the full moon.
    const max = at('18:11:43');
    expect(max).toBeGreaterThan(10 ** (-11 / 2.5));
    expect(max).toBeLessThan(10 ** (-8 / 2.5));
    expect(at('17:00:00')).toBeGreaterThan(max);
    expect(at('21:00:00')).toBe(1);
  });
});

describe('lunarCircumstances', () => {
  it('matches NASA GSFC (Espenak, LE2025Sep07T plot) contacts and magnitudes', () => {
    const obs = makeObserver({ lat: 28.6, lng: 77.2 });
    const c = lunarCircumstances(obs, utc('2025-09-01T00:00:00'));
    expect(c.kind).toBe(EclipseKind.Total);
    expect(Math.abs(c.umbralMagnitude - 1.3619)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(c.penumbralMagnitude - 2.344)).toBeLessThanOrEqual(0.001);
    expectContacts(c.contacts, [
      [ContactKind.P1, '2025-09-07T15:28:21'],
      [ContactKind.U1, '2025-09-07T16:27:02'],
      [ContactKind.U2, '2025-09-07T17:30:41'],
      [ContactKind.Max, '2025-09-07T18:11:43'],
      [ContactKind.U3, '2025-09-07T18:52:47'],
      [ContactKind.U4, '2025-09-07T19:56:26'],
      [ContactKind.P4, '2025-09-07T20:55:00']
    ]);
    expect(c.contacts.find((x) => x.kind === ContactKind.Max)?.visible).toBe(true);
  });
});
