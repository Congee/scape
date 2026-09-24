import { EclipseKind } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import type { HorizonProfile } from '@core/terrain/horizon';
import { makeObserver } from './bodies';
import { ContactKind, lunarCircumstances, solarCircumstances, type EclipseContact } from './eclipse';

const dms = (d: number, m: number) => Math.sign(d) * (Math.abs(d) + m / 60);
const MIN_MS = 60_000;
const utc = (s: string) => Date.parse(`${s}Z`);

type Expected = [ContactKind, string, number?, number?];

function expectContacts(got: EclipseContact[], want: Expected[]) {
  expect(got.map((c) => c.kind)).toEqual(want.map((w) => w[0]));
  want.forEach(([, t, alt, az], i) => {
    expect(Math.abs(got[i].timeMs - utc(t))).toBeLessThanOrEqual(MIN_MS);
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
    expect(Math.abs(c.magnitude - 1.0382)).toBeLessThanOrEqual(0.01);
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
    expect(Math.abs(c.magnitude - 0.9987)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(c.obscuration - 0.9996)).toBeLessThanOrEqual(0.01);
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
    expect(Math.abs(c.magnitude - 1.0558)).toBeLessThanOrEqual(0.01);
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

describe('lunarCircumstances', () => {
  it('matches NASA GSFC (Espenak, LE2025Sep07T plot) contacts and magnitudes', () => {
    const obs = makeObserver({ lat: 28.6, lng: 77.2 });
    const c = lunarCircumstances(obs, utc('2025-09-01T00:00:00'));
    expect(c.kind).toBe(EclipseKind.Total);
    expect(Math.abs(c.umbralMagnitude - 1.3619)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(c.penumbralMagnitude - 2.344)).toBeLessThanOrEqual(0.01);
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
