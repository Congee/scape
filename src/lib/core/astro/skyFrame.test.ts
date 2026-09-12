import { describe, expect, it } from 'vitest';
import { makeObserver, SkyBody } from './bodies';
import { position } from './positions';
import { apply, enuToEqj, eqjToEnu, horizontalOf, poleEnu } from './skyFrame';
import { eqjVector, POLARIS } from './stars';

const obs = makeObserver({ lat: 45, lng: 7 });
const time = new Date('2026-06-21T00:00:00Z');
const azDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('sky frame', () => {
  it('puts Polaris near the pole above true north', () => {
    const out = new Float64Array(3);
    const [x, y, z] = eqjVector(POLARIS.raDeg, POLARIS.decDeg);
    apply(eqjToEnu(time, obs), x, y, z, out);
    const h = horizontalOf(out[0], out[1], out[2]);
    expect(azDiff(h.azimuthDeg, 0)).toBeLessThan(1.2);
    expect(Math.abs(h.altitudeDeg - 45)).toBeLessThan(1);
  });

  it('agrees with astronomy-engine for the Galactic Centre', () => {
    const out = new Float64Array(3);
    const [x, y, z] = eqjVector(17.76112 * 15, -29.00781);
    for (const h of [0, 6, 12, 18]) {
      const t = new Date(time.getTime() + h * 3_600_000);
      apply(eqjToEnu(t, obs), x, y, z, out);
      const mine = horizontalOf(out[0], out[1], out[2]);
      const ref = position(SkyBody.Gc, t, obs);
      expect(azDiff(mine.azimuthDeg, ref.azimuth)).toBeLessThan(0.05);
      expect(Math.abs(mine.altitudeDeg - ref.altitude)).toBeLessThan(0.03);
    }
  });

  it('inverts', () => {
    const a = new Float64Array(3);
    const b = new Float64Array(3);
    apply(eqjToEnu(time, obs), 0.3, -0.5, 0.8124, a);
    apply(enuToEqj(time, obs), a[0], a[1], a[2], b);
    expect(b[0]).toBeCloseTo(0.3, 9);
    expect(b[1]).toBeCloseTo(-0.5, 9);
    expect(b[2]).toBeCloseTo(0.8124, 9);
  });

  it('finds the celestial pole at the latitude', () => {
    const [e, n, u] = poleEnu(time, obs);
    const h = horizontalOf(e, n, u, false);
    expect(azDiff(h.azimuthDeg, 0)).toBeLessThan(0.01);
    expect(h.altitudeDeg).toBeCloseTo(45, 2);
  });
});
